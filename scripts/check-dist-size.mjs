#!/usr/bin/env node
/**
 * dist 体积门禁。
 *
 * 背景（2026-08-31 的真实事故）：
 * fetch_dex_wins.py 每天下载 DexScreener 涨幅榜的代币 logo，只判断了下限
 * (`len(img) > 200`)、没设上限，也从不删除旧文件。DexScreener 的 header 图
 * 很多是动画 GIF，单文件最大 7.46 MB。攒了几个月后 public/logos/dex 到了
 * 45 MB / 106 个文件（其中 99 个是没人引用的孤儿），dist 随之涨到 67 MB。
 *
 * 结果是 Cloudflare Pages **构建成功、但发布资源失败**：
 *   Failed: an internal error occurred.
 *   Error: Failed to publish assets.
 * 站点从那天起再也部署不上去，而本地 `npm run build` 一直全绿 ——
 * 因为没有任何检查会去看产物到底有多大。
 *
 * 这个脚本就是那道缺失的检查。阈值留了充足余量，只在明显失控时才报错。
 */
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));

// Cloudflare Pages 的硬限制是单文件 25 MB、单次部署 20,000 个文件。
// 这里卡得比硬限制更紧，好在有征兆时就发现，而不是等到部署挂掉。
const MAX_TOTAL_BYTES = 40 * 1024 * 1024; // 40 MB
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_FILE_COUNT = 5000;

// 少数文件本来就大且必要，单独放行（但仍会计入总体积）
const ALLOWED_BIG_FILES = new Set(['/admin/decap-cms.js']);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else out.push({ p, size: st.size });
  }
  return out;
}

if (!existsSync(DIST)) {
  console.error('dist 不存在 —— 先跑 npm run build');
  process.exit(1);
}

const files = walk(DIST);
const total = files.reduce((s, f) => s + f.size, 0);
const big = files
  .filter((f) => f.size > MAX_FILE_BYTES)
  .sort((a, b) => b.size - a.size);
const oversized = big.filter(
  (f) => !ALLOWED_BIG_FILES.has(f.p.slice(DIST.length).replace(/\\/g, '/'))
);
const top = [...files].sort((a, b) => b.size - a.size).slice(0, 5);

const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;

console.log('文件总数:  ', files.length, `/ ${MAX_FILE_COUNT}`);
console.log('总体积:    ', mb(total), `/ ${mb(MAX_TOTAL_BYTES)}`);
console.log('最大 5 个文件:');
for (const f of top) {
  console.log(`  ${mb(f.size).padStart(10)}  ${f.p.slice(DIST.length)}`);
}

const failures = [];
if (files.length > MAX_FILE_COUNT) {
  failures.push(`文件数 ${files.length} 超过上限 ${MAX_FILE_COUNT}`);
}
if (total > MAX_TOTAL_BYTES) {
  failures.push(`总体积 ${mb(total)} 超过上限 ${mb(MAX_TOTAL_BYTES)}`);
}
for (const f of oversized) {
  failures.push(`单文件超过 ${mb(MAX_FILE_BYTES)}: ${f.p.slice(DIST.length)} (${mb(f.size)})`);
}

if (failures.length) {
  console.log('');
  for (const f of failures) console.log('  FAIL:', f);
  console.log('\n产物体积失控 —— 多半是又有自动生成的大文件没被清理。');
  console.log('检查 public/logos/ 下的图片，或跑 python scripts/prune-dex-logos.py --dry 看看。');
  process.exit(1);
}

console.log(`\nOK — 产物体积正常（${mb(total)}, ${files.length} 个文件）`);
