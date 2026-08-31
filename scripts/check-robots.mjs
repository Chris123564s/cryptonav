#!/usr/bin/env node
/**
 * robots.txt 门禁。
 *
 * 为什么需要：robots.txt 是全站唯一一个「写错一个字符就能让流量归零」的文件，
 * 而且它是静默失败 —— 没有报错、没有红字，只是 Googlebot 从某天起不再来了，
 * 等你在 GSC 里发现覆盖率掉到 0 可能已经是几周后。
 *
 * 现在我们又在这个文件里维护一份 20+ 爬虫的允许/拒绝清单和 Content Signals 策略，
 * 手工校对不现实。这里只断言几条「错了就完蛋」的规则，不做语法全量校验。
 */
import { readFileSync, existsSync } from 'node:fs';

const FILE = new URL('../public/robots.txt', import.meta.url);

let pass = 0;
const failures = [];
function ok(cond, label) {
  if (cond) pass++;
  else failures.push(label);
}

if (!existsSync(FILE)) {
  console.error('public/robots.txt 不存在');
  process.exit(1);
}

const text = readFileSync(FILE, 'utf8');
const lines = text.split('\n');

// --- 解析成 group：一组 User-agent 后跟若干规则 ---
const groups = [];
let current = null;
const sitemaps = [];

for (const raw of lines) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;

  const idx = line.indexOf(':');
  if (idx === -1) continue;
  const field = line.slice(0, idx).trim().toLowerCase();
  const value = line.slice(idx + 1).trim();

  if (field === 'user-agent') {
    // 连续的 User-agent 行共享同一组规则
    if (!current || current.closed) {
      current = { agents: [], rules: [], closed: false };
      groups.push(current);
    }
    current.agents.push(value.toLowerCase());
  } else if (field === 'sitemap') {
    sitemaps.push(value);
  } else if (current) {
    current.rules.push({ field, value });
    current.closed = true;
  }
}

// --- 1. 必须声明 sitemap，且是本站绝对地址 ---
ok(sitemaps.length > 0, '缺少 Sitemap 指令');
for (const s of sitemaps) {
  ok(/^https:\/\/cryptonav\.site\//.test(s), `Sitemap 不是本站的 https 绝对地址：${s}`);
}

// --- 2. 通配组绝不能全站封禁 ---
const wildcard = groups.filter((g) => g.agents.includes('*'));
ok(wildcard.length === 1, `期望恰好 1 个 "User-agent: *" 组，实际 ${wildcard.length} 个`);
if (wildcard.length === 1) {
  const g = wildcard[0];
  const blanket = g.rules.filter((r) => r.field === 'disallow' && r.value === '/');
  ok(
    blanket.length === 0,
    '"User-agent: *" 组里出现了 "Disallow: /" —— 这会让全站从搜索结果里消失'
  );
  ok(
    g.rules.some((r) => r.field === 'allow' && r.value === '/'),
    '"User-agent: *" 组里缺少 "Allow: /"'
  );
}

// --- 3. 同一个 agent 不能在多个组里定义（重复定义几乎总是笔误） ---
const seen = new Map();
for (const g of groups) {
  for (const a of g.agents) {
    if (seen.has(a)) {
      failures.push(`User-agent "${a}" 被定义了多次（第 ${seen.get(a)} 组和另一组）—— 通常是笔误`);
    } else {
      seen.set(a, groups.indexOf(g) + 1);
    }
  }
}

// --- 4. 声明 Allow 的组不能再出现 Disallow: /（自相矛盾，各家解析行为不一致） ---
for (const g of groups) {
  const allowsRoot = g.rules.some((r) => r.field === 'allow' && r.value === '/');
  const deniesRoot = g.rules.some((r) => r.field === 'disallow' && r.value === '/');
  if (allowsRoot && deniesRoot) {
    failures.push(
      `组 [${g.agents.join(', ')}] 同时写了 "Allow: /" 和 "Disallow: /"，规则自相矛盾`
    );
  }
}
if (!failures.some((f) => f.includes('自相矛盾'))) pass += groups.length;

// --- 5. Content Signals 策略必须存在且拒绝训练 ---
const signalLines = lines.filter((l) => l.trim().toLowerCase().startsWith('content-signal:'));
ok(signalLines.length > 0, '缺少 Content-Signal 指令');
for (const l of signalLines) {
  const value = l.slice(l.indexOf(':') + 1).trim();
  const pairs = value.split(',').map((p) => p.trim());
  const dict = {};
  for (const p of pairs) {
    const [k, v] = p.split('=').map((s) => s.trim());
    if (k) dict[k.toLowerCase()] = v;
  }
  ok(dict['ai-train'] === 'no', `Content-Signal 里 ai-train 应为 no，实际：${dict['ai-train']}`);
  ok(dict['search'] === 'yes', `Content-Signal 里 search 应为 yes，实际：${dict['search']}`);
  ok(dict['ai-input'] === 'yes', `Content-Signal 里 ai-input 应为 yes，实际：${dict['ai-input']}`);
}

// --- 6. 训练爬虫必须被拒（这是整套策略的落点，漏一个就等于没设） ---
const MUST_DISALLOW = ['gptbot', 'claudebot', 'google-extended', 'applebot-extended', 'ccbot'];
for (const agent of MUST_DISALLOW) {
  const g = groups.find((x) => x.agents.includes(agent));
  if (!g) {
    failures.push(`未对训练爬虫 "${agent}" 做出声明`);
    continue;
  }
  ok(
    g.rules.some((r) => r.field === 'disallow' && r.value === '/'),
    `训练爬虫 "${agent}" 没有被 Disallow —— 训练授权没有真正关掉`
  );
}

// --- 7. 引用型爬虫必须被允许（否则整个「让 AI 引用我们」的目标落空） ---
const MUST_ALLOW = ['oai-searchbot', 'claude-searchbot', 'perplexitybot'];
for (const agent of MUST_ALLOW) {
  const g = groups.find((x) => x.agents.includes(agent));
  if (!g) {
    failures.push(`未对引用型爬虫 "${agent}" 做出声明`);
    continue;
  }
  ok(
    g.rules.some((r) => r.field === 'allow' && r.value === '/'),
    `引用型爬虫 "${agent}" 没有 Allow —— 我们不会出现在 AI 答案里`
  );
  ok(
    !g.rules.some((r) => r.field === 'disallow' && r.value === '/'),
    `引用型爬虫 "${agent}" 被 Disallow 了 —— 与「允许引用」的目标冲突`
  );
}

// --- 输出 ---
const total = pass + failures.length;
console.log('groups:                ', groups.length);
console.log('sitemaps:              ', sitemaps.join(', ') || '(none)');
console.log('content-signal lines:  ', signalLines.length);
console.log('');
if (failures.length) {
  for (const f of failures) console.log('  FAIL:', f);
  console.log(`\n${pass}/${total} passed, ${failures.length} FAILED`);
  process.exit(1);
}
console.log(`${pass}/${total} passed`);
