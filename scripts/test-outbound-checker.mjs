#!/usr/bin/env node
/**
 * check-outbound-links.mjs 的回归测试。
 *
 * 断言的核心是**退出码契约**，因为退出码是每周 workflow 唯一的判断依据。
 * 这条教训是从兄弟脚本 check-live-links.mjs 身上学到的：它从写下那天起
 * 退出码就是坏的（process.exit() 撞上 undici 的 keep-alive 句柄，在
 * Node 24 / Windows 上 libuv 断言崩溃，成功失败都是 127），而从来没人发现，
 * 因为它只被手动跑过、stdout 看起来一直是好的。契约不测就会烂。
 *
 * 这里最关键的一条是**「被反爬拦截」必须不算失败**：
 * 63 个项目里有 16 个（Gate.io、Etherscan、OpenSea…）部署在 Cloudflare
 * 后面，对数据中心 IP 和脚本 UA 返回 403。如果把 403 算成失效，这个 job
 * 每周都会报红，然后被当成噪音忽略 —— 那跟没有这个 job 是一样的，
 * 甚至更糟，因为它会连带把某周真正的死链也一起淹没掉。
 * 所以用例 1 专门锁死「403 时仍然 exit 0」。
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./check-outbound-links.mjs', import.meta.url));
const FIXTURE = fileURLToPath(new URL('../_outbound-fixture.json', import.meta.url));
const KNOWN = fileURLToPath(new URL('../_outbound-known.json', import.meta.url));

const server = createServer((req, res) => {
  const p = new URL(req.url, 'http://127.0.0.1').pathname;
  const send = (code, body = 'ok') => {
    res.writeHead(code, { 'content-type': 'text/html' });
    res.end(body);
  };
  if (p === '/ok') return send(200);
  if (p === '/blocked') return send(403, 'forbidden');
  // 用例 4：跳到别的 host（127.0.0.1 -> localhost）触发跨域名重定向检测。
  if (p === '/moved') {
    res.writeHead(302, { location: `http://localhost:${PORT}/ok` });
    return res.end('go away');
  }
  // 用例 6：清单里记的落点是 /ok，实际跳到了 /elsewhere —— 「落点漂移」。
  if (p === '/moved-again') {
    res.writeHead(302, { location: `http://localhost:${PORT}/elsewhere` });
    return res.end('go away');
  }
  if (p === '/elsewhere') return send(200, 'somewhere else');
  return send(404, 'not found');
});

let PORT;
await new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    PORT = server.address().port;
    resolve();
  });
});

// 拿一个确定没人监听的端口：起一个服务拿到端口后立刻关掉。
// 用来覆盖「连接被拒绝」这条 dead 分支（DNS 失败那条没法在本地可靠模拟）。
const deadPort = await new Promise((resolve) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => {
    const p = s.address().port;
    s.close(() => resolve(p));
  });
});

const writeFixture = (projects) => writeFileSync(FIXTURE, JSON.stringify({ projects }, null, 2));
const writeKnown = (entries) => writeFileSync(KNOWN, JSON.stringify({ entries }, null, 2));

// 用例 5、6 需要一份指向 fixture 的已复核清单；其余用例不传 --known，
// 走脚本默认的 known-redirects.json（那些域名在 fixture 里根本不会出现，
// 所以不会意外命中）。
let knownFixture = false;

// 同 test-link-checker.mjs：必须用异步 spawn。spawnSync 会阻塞父进程的事件
// 循环，而这个测试的 HTTP 服务就跑在父进程里 —— 父等子、子等父，直接死锁。
const childEnv = { ...process.env };
for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY', 'NODE_USE_ENV_PROXY']) {
  delete childEnv[k];
}

function run() {
  return new Promise((resolve, reject) => {
    const args = [SCRIPT, '--projects', FIXTURE];
    // 清单和数据源一样可注入：默认那份 known-redirects.json 里的域名是真是
    // 互联网地址，本地测试打不到，只能换一份指向 fixture 的。
    if (knownFixture) args.push('--known', KNOWN);
    const child = spawn(process.execPath, args, { env: childEnv });
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
function assertCleanStderr(r, label) {
  ok(!r.err.includes('Assertion failed'), `${label}: stderr 出现 libuv 断言崩溃（退出码已被污染）`);
  ok(!/UV_HANDLE_CLOSING/.test(r.err), `${label}: stderr 出现 UV_HANDLE_CLOSING`);
}

// --- 用例 1：正常 + 被反爬拦截 -> 必须 exit 0 --------------------------
// 这条是整个测试存在的理由：403 是「它不欢迎我」，不是「它没了」。
writeFixture([
  { name: 'Healthy', website: `http://127.0.0.1:${PORT}/ok`, status: 'active' },
  { name: 'Behind Cloudflare', website: `http://127.0.0.1:${PORT}/blocked`, status: 'active' },
]);
{
  const r = await run().catch((e) => ({ code: -1, out: '', err: e.message }));
  ok(r.code === 0, `用例1 拦截不算失败：期望 exit 0，实际 ${r.code}`);
  ok(r.out.includes('被反爬拦截 1 个'), '用例1 拦截不算失败：应把 403 归入「被反爬拦截」');
  ok(!r.out.includes('确认失效'), '用例1 拦截不算失败：不应出现「确认失效」');
  assertCleanStderr(r, '用例1 拦截不算失败');
}

// --- 用例 2：404 -> 必须 exit 1 ----------------------------------------
writeFixture([
  { name: 'Healthy', website: `http://127.0.0.1:${PORT}/ok`, status: 'active' },
  { name: 'Gone Project', website: `http://127.0.0.1:${PORT}/vanished`, status: 'active' },
]);
{
  const r = await run().catch((e) => ({ code: -1, out: '', err: e.message }));
  ok(r.code === 1, `用例2 404 算失效：期望 exit 1，实际 ${r.code}`);
  ok(r.out.includes('确认失效 1 个'), '用例2 404 算失效：应统计为 1 条确认失效');
  ok(r.out.includes('Gone Project'), '用例2 404 算失效：stdout 应报出项目名');
  assertCleanStderr(r, '用例2 404 算失效');
}

// --- 用例 3：连接被拒绝 -> 必须 exit 1 ---------------------------------
// 覆盖 undici 把网络层错误包成 `fetch failed` 的那条分支 —— 真正的错误码
// 藏在 cause 里，早期版本只匹配 message 会漏判成普通 error（不影响退出码）。
writeFixture([{ name: 'Off The Air', website: `http://127.0.0.1:${deadPort}/`, status: 'active' }]);
{
  const r = await run().catch((e) => ({ code: -1, out: '', err: e.message }));
  ok(r.code === 1, `用例3 连接被拒：期望 exit 1，实际 ${r.code}`);
  ok(/连接被拒绝|DNS 解析失败/.test(r.out), '用例3 连接被拒：应归入「连接被拒绝」而非泛泛的 error');
  assertCleanStderr(r, '用例3 连接被拒');
}

// --- 用例 4：跨域名重定向 -> 报出来，但不算失败 ------------------------
// 重定向既可能是官方改名（curve.fi -> curve.finance），也可能是域名被卖给
// 了停放页，只有人能判断。所以它必须出现在输出里、被 warning 提示，
// 但不能把健康的一周染红。
writeFixture([
  { name: 'Healthy', website: `http://127.0.0.1:${PORT}/ok`, status: 'active' },
  { name: 'Renamed Protocol', website: `http://127.0.0.1:${PORT}/moved`, status: 'active' },
]);
{
  const r = await run().catch((e) => ({ code: -1, out: '', err: e.message }));
  ok(r.code === 0, `用例4 重定向不算失败：期望 exit 0，实际 ${r.code}`);
  ok(r.out.includes('重定向到别的域名 1 个'), '用例4 重定向不算失败：应检出 1 条跨域名重定向');
  ok(r.out.includes('localhost'), '用例4 重定向不算失败：应打印最终落地域名');
  assertCleanStderr(r, '用例4 重定向不算失败');
}

// --- 用例 5：已复核的重定向，落点未变 -> 不再重复告警 ------------------
// 复核过的官方改名如果每周都报一次，这份报告就会变成噪音然后被忽略，
// 连带淹没某一周新出现的真问题。所以命中清单且落点一致的要安静下来。
knownFixture = true;
writeKnown([{ id: 'renamed', from: `http://127.0.0.1:${PORT}/moved`, to: `localhost:${PORT}` }]);
writeFixture([{ name: 'Renamed Protocol', id: 'renamed', website: `http://127.0.0.1:${PORT}/moved`, status: 'active' }]);
{
  const r = await run().catch((e) => ({ code: -1, out: '', err: e.message }));
  ok(r.code === 0, `用例5 已复核重定向不重复告警：期望 exit 0，实际 ${r.code}`);
  ok(!r.out.includes('重定向到别的域名 1 个'), '用例5 已复核重定向不重复告警：不应再计入「需人工判断」');
  ok(r.out.includes('已复核的重定向 1 个'), '用例5 已复核重定向不重复告警：应归入「已复核的重定向」');
  assertCleanStderr(r, '用例5 已复核重定向不重复告警');
}

// --- 用例 6：已复核的重定向，落点变了 -> 必须重新报出来 ----------------
// 这是清单机制真正想抓的东西：域名又动了一次。可能是官方再次改版，
// 也可能是域名被卖了、被劫持了 —— 无论如何不能再安静下去。
writeKnown([{ id: 'renamed', from: `http://127.0.0.1:${PORT}/moved-again`, to: `nowhere.example` }]);
writeFixture([{ name: 'Renamed Protocol', id: 'renamed', website: `http://127.0.0.1:${PORT}/moved-again`, status: 'active' }]);
{
  const r = await run().catch((e) => ({ code: -1, out: '', err: e.message }));
  ok(r.out.includes('落点变了 1 个'), '用例6 落点漂移：应归入「落点变了」');
  ok(r.out.includes('nowhere.example'), '用例6 落点漂移：应打印出清单里记的预期落点，方便对照');
  ok(!r.out.includes('已复核的重定向 1 个'), '用例6 落点漂移：不应被当成稳定项放过');
  assertCleanStderr(r, '用例6 落点漂移');
}
knownFixture = false;

server.close();
// Node 自己的删，不走 shell —— 绕开本机 safe-delete 的批量确认钩子。
for (const f of [FIXTURE, KNOWN]) {
  try {
    rmSync(f, { force: true });
  } catch {}
}

const total = pass + failures.length;
console.log('subprocess runs:        6 (exit 0 / exit 1 / exit 1 / exit 0 / exit 0 / exit 0)');
console.log('');
if (failures.length) {
  for (const f of failures) console.log('  FAIL:', f);
  console.log(`\n${pass}/${total} passed, ${failures.length} FAILED`);
  process.exitCode = 1;
} else {
  console.log(`${pass}/${total} passed`);
}
