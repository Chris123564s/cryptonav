#!/usr/bin/env node
/**
 * 一次性清理脚本：删掉 projects.json 里 8 条伪造的 referral 链接。
 *
 * 背景：当初建站时给 8 家交易所各写了一条 "ref=Cryptonav" 的 referral，
 * 这个返佣码在任何交易所都不存在。getReferralUrl() 在 affiliates.json 的 code
 * 为空时会回退到 p.referral，于是全站在往外发假联盟链接 —— 用户在注册、在交易，
 * 但一分钱拿不到。删掉后回退到 p.website（官网首页），至少不再带无效返佣参数。
 *
 * 用文本行过滤而不是 JSON.parse/stringify，是为了不动 projects.json 里
 * 手工排版的缩进和内联对象（之前 round-trip 一次产生了 865 行 diff）。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../src/data/projects.json', import.meta.url);
const PLACEHOLDER = 'Cryptonav';

const src = readFileSync(FILE, 'utf8');
const lines = src.split('\n');

const kept = [];
const removed = [];
for (const line of lines) {
  const isFakeReferral =
    /^\s*"referral":\s*"https:\/\/[^"]+Cryptonav/.test(line);
  if (isFakeReferral) removed.push(line.trim());
  else kept.push(line);
}

if (removed.length === 0) {
  console.error('没有找到任何伪造的 referral 行 —— 可能已经清理过了，未做任何改动。');
  process.exit(1);
}

const out = kept.join('\n');

// 改完必须仍然是合法 JSON，否则不落盘
let parsed;
try {
  parsed = JSON.parse(out);
} catch (e) {
  console.error('清理后 JSON 解析失败，未写入任何内容：', e.message);
  process.exit(1);
}

// 确保没有任何项目还残留 referral 字段
const leftovers = (parsed.projects || [])
  .filter((p) => p.referral)
  .map((p) => `${p.id}: ${p.referral}`);
if (leftovers.length > 0) {
  console.error('仍有项目残留 referral 字段，未写入：\n  ' + leftovers.join('\n  '));
  process.exit(1);
}

writeFileSync(FILE, out);
console.log(`已删除 ${removed.length} 条伪造 referral：`);
for (const r of removed) console.log('  - ' + r);
console.log(`\n剩余带 referral 的项目：0`);
console.log(`${(parsed.projects || []).length} 个项目的链接现在统一回退到 website 字段。`);
