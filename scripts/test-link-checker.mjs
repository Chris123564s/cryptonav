#!/usr/bin/env node
/**
 * check-live-links.mjs 的回归测试。
 *
 * 为什么需要这个测试：
 *
 * 2026-09-04 发现，那个脚本从写下那天起退出码就是坏的。它在结尾调用
 * process.exit()，而 Node 的 fetch 用的 undici 连接池还开着 keep-alive 句柄；
 * 在 Node 24 / Windows 上，进程会在 libuv 里断言崩溃：
 *
 *     Assertion failed: !(handle->flags & UV_HANDLE_CLOSING),
 *     file src\win\async.c, line 76
 *
 * 然后退出码变成 127 —— 通过和失败两种情况都是 127。
 *
 * 之所以一直没被发现，是因为它只被手动跑过：人看的是 stdout 上的
 * "no dead internal links"，从来没人检查退出码。而退出码恰恰是
 * check-links.yml 唯一的判断依据。如果没有这个测试，健康站点会被
 * 每周报红，或者更糟 —— 真死链时也可能被当成通过。
 *
 * 所以这个测试断言的是「进程退出码」这个契约本身，而不只是输出文本。
 * 它起一个本地 HTTP 服务（不需要网络、不需要代理），用子进程跑真实的
 * 爬虫脚本，然后断言退出码。
 *
 * 关于爬取深度（写这个用例时才确认的行为，不是设计目标）：
 * 爬虫只从 sitemap 列出的页面里提取 href，不会顺着结果继续往下爬。
 * 所以「检查了哪些链接」取决于 sitemap 的覆盖面，而「检查了哪些页面」
 * 只有 sitemap 那一层。这够用 —— 访客从被索引的页面点出去能到达的每个
 * 站内目标都会被验证到 200；但若某个页面不在 sitemap 里、又只有它才
 * 指向某个死链，那条死链查不出来。要覆盖就得改成 BFS，代价是运行时间
 * 翻倍（现网 110 个 URL 已经要跑 4~5 分钟）。暂时不做，如实记录。
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./check-live-links.mjs', import.meta.url));

// 可变的页面内容：不同的用例需要首页返回不同的链接集合。
const state = {
  indexLinks: '',
  sitemap404: false,
};

const page = (links) => `<!doctype html>
<html><body>
${links.map((h) => `<a href="${h}">${h}</a>`).join('\n')}
</body></html>`;

const sitemap = (locs) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${locs.map((l) => `  <url><loc>${l}</loc></url>`).join('\n')}
</urlset>`;

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;
  const send = (code, body, type = 'text/html') => {
    res.writeHead(code, { 'content-type': type });
    res.end(body);
  };

  if (p === '/sitemap-index.xml') {
    return send(200, `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>http://127.0.0.1:${PORT}/sitemap-0.xml</loc></sitemap>
</sitemapindex>`, 'application/xml');
  }
  if (p === '/sitemap-0.xml') {
    // 用例 3：子 sitemap 本身 404 —— 爬取会静默缩小覆盖面，必须算失败。
    if (state.sitemap404) return send(404, 'not found', 'text/plain');
    return send(200, sitemap([`http://127.0.0.1:${PORT}/`]), 'application/xml');
  }
  if (p === '/' || p === '/index.html') return send(200, page(state.indexLinks.split('\n').filter(Boolean)));
  if (p === '/good' || p === '/good/') return send(200, page(['/']));
  if (p === '/style.css') return send(200, 'body{}', 'text/css');
  return send(404, 'not found', 'text/plain');
});

let PORT;
await new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    PORT = server.address().port;
    resolve();
  });
});

// 子进程环境里剥掉代理变量：本机的 http_proxy 会让子进程的 fetch 去走代理
// 连 127.0.0.1，测试就会以「网络不通」的方式假失败。CI 上没有代理，
// 但显式清掉才能保证本地和 CI 行为一致。
const childEnv = { ...process.env };
for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY', 'NODE_USE_ENV_PROXY']) {
  delete childEnv[k];
}

// 必须用异步 spawn，不能用 spawnSync。
//
// spawnSync 会阻塞父进程的事件循环，而这个测试的 HTTP 服务就跑在父进程里
// —— 父进程一边等着子进程结束，子进程一边等着父进程响应它的 HTTP 请求，
// 双方都没法前进，直接死锁到超时（第一次写就是用 spawnSync，卡满 300s
// 被 SIGTERM，且 stdout 一行都没有）。异步 spawn 让父进程能同时服务请求。
//
// 也不启用 shell：参数以数组传入，路径里的空格（C:/Users/a/WorkBuddy AI/...）
// 不需要转义；开了 shell 反而要处理转义，是纯粹的多余风险。
function run() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, `http://127.0.0.1:${PORT}`], { env: childEnv });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('子进程超过 120s 未结束'));
    }, 120_000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
  });
}

let pass = 0;
const failures = [];
function ok(cond, label) {
  if (cond) pass++;
  else failures.push(label);
}

// 每个用例都断言 stderr 干净：那条 libuv 断言崩溃就是往 stderr 打印的，
// 且它只在部分时机触发（连接池里还有 keep-alive 连接时）。抓 stdout 文本
// 抓不到它，只有盯住 stderr 和退出码才行。
function assertCleanStderr(r, label) {
  ok(!r.err.includes('Assertion failed'), `${label}: stderr 出现 libuv 断言崩溃（退出码已被污染）`);
  ok(!/UV_HANDLE_CLOSING/.test(r.err), `${label}: stderr 出现 UV_HANDLE_CLOSING`);
}

// --- 用例 1：全站正常 -> 必须 exit 0 -----------------------------------
// 首页链接包含：一个正常页、一个 Cloudflare 邮箱混淆地址（必须被跳过）、
// 一个 css 资源（必须被跳过）、一个外链（必须被跳过）。
state.sitemap404 = false;
state.indexLinks = ['/good/', '/cdn-cgi/l/email-protection#abc', '/style.css', 'https://example.com/x'].join('\n');
{
  const r = await run().catch((e) => ({ code: -1, out: '', err: e.message }));
  ok(r.code === 0, `用例1 全正常：期望 exit 0，实际 ${r.code}`);
  ok(r.out.includes('no dead internal links'), '用例1 全正常：stdout 应含 "no dead internal links"');
  // 只可能是 /good 这 1 条。原因见文件顶部的「爬取深度」说明：爬虫只从
  // sitemap 列出的页面里提取 href，本用例的 sitemap 只有 / ，所以 /good 页
  // 面自己发出的链接（它内部有 <a href="/">）不会被采集。
  // 若 cdn-cgi / css 资源 / 外链这三道过滤任一失效，这个数字会变大。
  const got = (r.out.match(/internal links found: (\d+)/) || [])[1] ?? '(未输出)';
  ok(got === '1', `用例1 全正常：应找到 1 条内链，实际 ${got}`);
  assertCleanStderr(r, '用例1 全正常');
}

// --- 用例 2：存在死链 -> 必须 exit 1 -----------------------------------
state.indexLinks = ['/good/', '/broken-page/'].join('\n');
{
  const r = await run().catch((e) => ({ code: -1, out: '', err: e.message }));
  ok(r.code === 1, `用例2 有死链：期望 exit 1，实际 ${r.code}`);
  ok(r.out.includes('/broken-page'), '用例2 有死链：stdout 应报出 /broken-page');
  ok(r.out.includes('1 dead internal link(s)'), '用例2 有死链：应统计为 1 条死链');
  assertCleanStderr(r, '用例2 有死链');
}

// --- 用例 3：子 sitemap 404 -> 必须 exit 1 ------------------------------
// 这是最容易静默通过的一类：爬取覆盖面悄悄变成 0，脚本却输出
// "no dead internal links" 并退出 0。
state.sitemap404 = true;
{
  const r = await run().catch((e) => ({ code: -1, out: '', err: e.message }));
  ok(r.code === 1, `用例3 sitemap 404：期望 exit 1，实际 ${r.code}`);
  ok(/crawl itself is broken|\(sitemap\)/.test(r.out), '用例3 sitemap 404：应报告爬取本身出了问题');
  assertCleanStderr(r, '用例3 sitemap 404');
}

server.close();

const total = pass + failures.length;
console.log(`subprocess runs:        3 (exit 0 / exit 1 / exit 1)`);
console.log('');
if (failures.length) {
  for (const f of failures) console.log('  FAIL:', f);
  console.log(`\n${pass}/${total} passed, ${failures.length} FAILED`);
  process.exitCode = 1;
} else {
  console.log(`${pass}/${total} passed`);
}
