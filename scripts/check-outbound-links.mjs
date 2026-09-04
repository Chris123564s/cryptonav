#!/usr/bin/env node
/**
 * 外链存活性审计：projects.json 里 63 个项目，它们的官网现在还活着吗？
 *
 * 为什么需要：
 * 安全评分（build-safety-report.mjs）只有 longevity / incidents / contract
 * 三个维度，**没有任何一条检查外链是否可达**。导航站的全部价值就在于它指出去的
 * 那些链接，一个指向已关站项目的链接比没链接更糟 —— 用户点了发现是个
 * 域名停放页，他对整个目录的信任就没了。而这类失效是完全静默的：
 * 构建不会报错，页面照常渲染，只有真实访客会撞上。
 *
 * 用法：
 *   node scripts/check-outbound-links.mjs
 *   node scripts/check-outbound-links.mjs --json
 *   node scripts/check-outbound-links.mjs --projects <path.json>   (测试用)
 *   node scripts/check-outbound-links.mjs --known <path.json>       (测试用)
 *
 * 关于「被拦截」和「真死了」必须分开看（这是这个脚本最重要的一点）：
 * 大量加密站点部署在 Cloudflare / Akamai 后面，会对数据中心 IP 和脚本 UA
 * 返回 403、429、503 或一段 JS 挑战页。**那不代表站点挂了**，只代表它不欢迎
 * 这个请求。把它们一律标成死链，报告就会被一堆假阳性淹没，然后整份报告会被
 * 忽略 —— 跟"每周都报红的死链巡检"是同一个死法。
 * 所以分类里 block / challenge 是「不确定」，不是「坏了」，也不影响退出码。
 *
 * 退出码：只有确认失效（DNS 解析失败 / 连接被拒 / 404 / 410 / 证书无效 /
 * 重试后仍 5xx）才置 1。用的是 process.exitCode 而不是 process.exit() ——
 * 后者会在 undici 的 keep-alive 句柄还没关闭时强杀进程，在 Node 24 / Windows
 * 上让退出码变成 127（成功失败都是 127），具体见 check-live-links.mjs 的注释。
 */
import { readFileSync } from 'node:fs';

// --projects exists so the exit-code contract can be tested against a fixture
// (see test-outbound-checker.mjs). The contract is the only signal the weekly
// workflow reads, and a contract nobody tests is a contract that rots -- the
// sibling crawler shipped a broken one and nobody noticed for as long as it
// had existed, because its stdout still looked healthy.
const projectsArgIdx = process.argv.indexOf('--projects');
const PROJECTS =
  projectsArgIdx > -1 && process.argv[projectsArgIdx + 1]
    ? process.argv[projectsArgIdx + 1]
    : new URL('../src/data/projects.json', import.meta.url);

// 已人工复核过的跨域名重定向，见 known-redirects.json。
//
// 为什么要这份清单：重定向警告是设计成「每周都看一眼」的，但如果同一个
// 官方改名每周都报一次，它就会变成噪音，然后整份报告被忽略 —— 而这正是
// 上面区分 block / dead 时想避免的死法，只是换了个入口。
//
// 所以复核过的落点不变就降级成一行说明；**落点变了反而要大声报**，因为那
// 意味着域名又动了一次，可能是被卖了，也可能是清单过期了。
const knownArgIdx = process.argv.indexOf('--known');
const KNOWN_REDIRECTS =
  knownArgIdx > -1 && process.argv[knownArgIdx + 1]
    ? process.argv[knownArgIdx + 1]
    : new URL('./known-redirects.json', import.meta.url);
let knownEntries = [];
try {
  knownEntries = JSON.parse(readFileSync(KNOWN_REDIRECTS, 'utf8')).entries || [];
} catch {
  knownEntries = [];
}
const hostOf = (u) => {
  try {
    return new URL(u).host.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const TIMEOUT_MS = 25_000;
const MAX_ATTEMPTS = 2;
const CONCURRENCY = 6;

// 用真实浏览器的 UA。默认的 Node UA 会被相当一部分站点直接挡掉，
// 制造出一批"看起来死了其实活得好好的"假阳性。
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asJson = process.argv.includes('--json');

// Goes through a proxy? Then these numbers are not trustworthy.
//
// Measured on 2026-09-04: with http_proxy / https_proxy set to this machine's
// local proxy, Node's built-in fetch failed on 40 of 63 sites -- including
// binance.com, coinbase.com and coingecko.com -- every one with `fetch failed`
// wrapping ECONNRESET or "Request was cancelled". curl through the *same*
// proxy at the *same* moment returned 200/202/403 for every one of them.
//
// So the failures were the proxy, not the sites. Had they been reported as
// errors they would have looked like 40 broken links on a nav site -- a
// five-alarm fire that did not exist. Hence the warning: say out loud that
// this environment cannot be trusted to judge reachability, instead of
// printing a table of numbers that quietly means nothing.
//
// GitHub Actions has direct network access, which is where this is meant to
// run. Same conclusion verify-sources.mjs reached for its own probes.
const PROXY_VARS = ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY'];
const activeProxies = PROXY_VARS.filter((k) => process.env[k]);
if (activeProxies.length && !asJson) {
  console.log('⚠️  检测到代理环境变量：' + activeProxies.join(', '));
  console.log('   本机（Node fetch + 本地代理）测外链不可靠 —— 同一时刻 curl 全部成功、');
  console.log('   Node fetch 全部 ECONNRESET。下面的 error/timeout 大概率是本机网络，');
  console.log('   **不是**站点挂了。要可信结果请在直连网络（如 GitHub Actions）下运行，');
  console.log('   或改用 curl 逐条核对。');
  console.log('');
}

const data = JSON.parse(readFileSync(PROJECTS, 'utf8'));
const projects = (data.projects || []).filter((p) => p.status === 'active' && p.website);

/** 判定一个响应属于哪一类。返回 null 表示"可以重试"。 */
function classify(status, err) {
  if (err) {
    const m = String(err.message || err);
    // undici 把 DNS / 连接层错误统一包成 fetch failed，真正的在 cause 里。
    const cause = String(err.cause?.code || err.cause?.message || '');
    if (/ENOTFOUND|EAI_AGAIN/.test(cause + m)) return { kind: 'dead', why: 'DNS 解析失败' };
    if (/ECONNREFUSED/.test(cause + m)) return { kind: 'dead', why: '连接被拒绝' };
    if (/CERT_|certificate/i.test(cause + m)) return { kind: 'dead', why: '证书无效' };
    if (/ETIMEDOUT|UND_ERR_HEADERS_TIMEOUT|timed? ?out/i.test(cause + m)) return { kind: 'timeout', why: '超时' };
    return { kind: 'error', why: m.slice(0, 80) };
  }
  if (status >= 200 && status < 300) return { kind: 'ok', why: '' };
  if (status === 404 || status === 410) return { kind: 'dead', why: `HTTP ${status}` };
  // 401/403/429 以及 Cloudflare 那类 503 挑战 —— 不欢迎我们，不代表站点没了。
  if (status === 401 || status === 403 || status === 429) return { kind: 'block', why: `HTTP ${status}` };
  if (status >= 500) return null; // 可重试
  return { kind: 'warn', why: `HTTP ${status}` };
}

async function check(p) {
  const start = p.website;
  for (let attempt = 1; ; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(start, {
        redirect: 'follow',
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
        signal: ac.signal,
      });
      clearTimeout(timer);
      const verdict = classify(res.status, null);
      if (verdict === null) {
        if (attempt < MAX_ATTEMPTS) { await sleep(1500); continue; }
        return { ...p, kind: 'error', why: `HTTP ${res.status}（重试后仍失败）`, final: res.url };
      }
      // 重定向到别的域名 = 值得单独看一眼：可能是收购/改名，
      // 也可能是域名已经被卖给了停放页。
      let crossDomain = null;
      try {
        const a = new URL(start);
        const b = new URL(res.url);
        if (a.host.replace(/^www\./, '') !== b.host.replace(/^www\./, '')) crossDomain = b.host;
      } catch {}

      // 已复核过的：落点对得上就安静，对不上就是新情况，必须重新报出来。
      if (crossDomain) {
        const entry = knownEntries.find((e) => e.id === p.id || e.from === p.website);
        if (entry) {
          const expected = hostOf(`https://${entry.to}`);
          const landed = hostOf(res.url);
          if (expected && landed === expected) {
            return { ...p, ...verdict, final: res.url, crossDomain, status: res.status, allowlisted: true };
          }
          return {
            ...p,
            ...verdict,
            final: res.url,
            crossDomain,
            status: res.status,
            drifted: true,
            expected: entry.to,
          };
        }
      }
      return { ...p, ...verdict, final: res.url, crossDomain, status: res.status };
    } catch (e) {
      clearTimeout(timer);
      const verdict = classify(0, e);
      if (verdict && (verdict.kind === 'dead' || verdict.kind === 'timeout')) return { ...p, ...verdict, final: null };
      if (attempt < MAX_ATTEMPTS) { await sleep(1500); continue; }
      return { ...p, ...(verdict || { kind: 'error', why: String(e.message || e).slice(0, 80) }), final: null };
    }
  }
}

// 并发跑，但不要太高：63 个站点里不少是同一家 CDN，
// 打太猛只会把自己的 IP 送进限流名单，制造更多假阳性。
const results = [];
const queue = [...projects];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const p = queue.shift();
      results.push(await check(p));
    }
  })
);

results.sort((a, b) => a.name.localeCompare(b.name));

const bucket = (k) => results.filter((r) => r.kind === k);
const dead = bucket('dead');
const err = bucket('error');
const timeout = bucket('timeout');
const warn = bucket('warn');
const block = bucket('block');
const ok = bucket('ok');
// crossDomain 里已经排除掉这两类，避免同一个重定向被报两次。
const drifted = results.filter((r) => r.drifted);
const allowlisted = results.filter((r) => r.allowlisted);

if (asJson) {
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), total: results.length, results }, null, 2));
} else {
  const line = (r) => `  ${String(r.name).padEnd(24)} ${String(r.why).padEnd(22)} ${r.website}${r.crossDomain ? `  ->  ${r.final}` : ''}`;
  console.log(`外链审计：${results.length} 个 active 项目`);
  console.log('');
  if (dead.length) { console.log(`❌ 确认失效 ${dead.length} 个：`); dead.forEach((r) => console.log(line(r))); console.log(''); }
  if (err.length) { console.log(`⚠️  请求出错 ${err.length} 个：`); err.forEach((r) => console.log(line(r))); console.log(''); }
  if (timeout.length) { console.log(`⏱  超时 ${timeout.length} 个（可能只是本机网络）：`); timeout.forEach((r) => console.log(line(r))); console.log(''); }
  if (warn.length) { console.log(`🔸 其它状态码 ${warn.length} 个：`); warn.forEach((r) => console.log(line(r))); console.log(''); }

  // 三类重定向分开放，因为它们的处置完全不同：
  // 落点变了 = 清单过期或域名出事，必须重新看；没见过的 = 首次发现，需要判断；
  // 已复核且稳定的 = 已经决定不动了，只列出来证明它还在被盯着。
  if (drifted.length) {
    console.log(`🔴 已复核重定向的落点变了 ${drifted.length} 个（清单过期或域名出问题）：`);
    drifted.forEach((r) => console.log(`${line(r)}   预期 ${r.expected}`));
    console.log('');
  }
  const cross = results.filter((r) => r.crossDomain && !r.allowlisted && !r.drifted);
  if (cross.length) { console.log(`↪️  重定向到别的域名 ${cross.length} 个（需人工判断是否正常）：`); cross.forEach((r) => console.log(line(r))); console.log(''); }
  if (allowlisted.length) {
    console.log(`✅ 已复核的重定向 ${allowlisted.length} 个（落点未变，无需处理）：`);
    allowlisted.forEach((r) => console.log(line(r)));
    console.log('');
  }
  if (block.length) { console.log(`🛡  被反爬拦截 ${block.length} 个（不代表站点有问题）：`); block.forEach((r) => console.log(`  ${String(r.name).padEnd(24)} ${String(r.why).padEnd(22)} ${r.website}`)); console.log(''); }
  console.log(`✅ 正常 ${ok.length} 个`);
  console.log('');
  console.log(`汇总：正常 ${ok.length} / 拦截 ${block.length} / 失效 ${dead.length} / 出错 ${err.length} / 超时 ${timeout.length} / 其它 ${warn.length} / 待判重定向 ${cross.length} / 落点漂移 ${drifted.length}`);
}

// 只有"确认失效"才算失败。拦截和超时都不算 —— 否则这份报告会天天报红，
// 然后被当成噪音忽略掉，那就等于没有。
process.exitCode = dead.length > 0 ? 1 : 0;
