// Content / SEO audit over the build output.
//
// This is a DIAGNOSTIC, not a test — it never exits non-zero and is deliberately
// NOT in the `npm test` chain. It measures things that have no correct value, so
// asserting on them would only produce noise. Run it after `npm run build`, then
// compare against the previous run: the numbers that move are the story.
//
// Written 2026-09-11 to replace four throwaway scripts. The findings it produced
// are in CryptoNav-SEO审计-2026-09-11.md; the method is in the skill
// static-site-seo-audit.
//
//   node scripts/audit-content.mjs
//
// NOTE: run it against a CLEAN dist. In the sandbox, astro build aborts before
// astro:build:done (safe-delete guard), so dist/ accumulates stale files from
// earlier builds and every count here will be inflated.
import fs from 'node:fs';
import path from 'node:path';

const DIST = 'dist';

// Routes that are not content and would skew every distribution. /embed/* is a
// 17-word iframe badge; /admin/ is a Decap shell with no body copy.
const EXCLUDED = [/^\/embed\//, /^\/admin\//];

// Page families, so the report can show effort-vs-commercial-value per family
// instead of one meaningless site-wide median.
const FAMILIES = [
  ['/category/*  category landing (money)', /^\/category\//],
  ['/compare/*   comparison (money)', /^\/compare\//],
  ['/verify/*    safety record', /^\/verify\//],
  ['/chain/*     chain hub', /^\/chain\//],
  ['/learn/*     article', /^\/learn\//],
];

// First-party experience signals. A 0/N on a money page family in a YMYL niche
// (crypto/finance) is the single most actionable finding this script can produce.
const EXPERIENCE =
  /\bwe (checked|tested|verified|analyzed|analysed|reviewed|audited)\b|\bour (data|testing|analysis|research|methodology)\b|\bfirst-party\b|\bproprietary\b/gi;

const KB = (s) => Buffer.byteLength(s, 'utf8') / 1024;
const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

const routeOf = (f) => {
  const r = f.slice(DIST.length).replace(/\\/g, '/').replace(/\/index\.html$/, '/');
  return r.startsWith('/') ? r : '/' + r;
};

// Body text only. Inline <svg>/<style>/<script> are markup, not prose — leaving
// them in would make every icon-heavy page look like it has content.
const textOf = (h) =>
  h
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ');

const words = (t) => (t.trim().match(/\S+/g) || []).length;

// Internal links only: same-origin navigable hrefs. Excludes assets and the
// /cdn-cgi/ email-obfuscation redirects (which are not crawlable targets).
const internalLinks = (h) =>
  [...h.matchAll(/href="(\/[^"]*)"/g)]
    .map((m) => m[1])
    .filter((u) => !/^\/(_astro|logos|favicon|cdn-cgi)\b/.test(u));

const normalize = (u) => u.replace(/[?#].*$/, '').replace(/\/$/, '') || '/';

// ---------------------------------------------------------------------------

if (!fs.existsSync(DIST)) {
  console.error(`No ${DIST}/ — run "npm run build" first.`);
  process.exitCode = 1;
} else {
  const all = walk(DIST).map((f) => {
    const html = fs.readFileSync(f, 'utf8');
    return { route: routeOf(f), html, text: textOf(html) };
  });
  const real = all.filter((p) => !EXCLUDED.some((re) => re.test(p.route)));
  const w = real.map((p) => words(p.text));
  const sorted = [...w].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const mean = w.length ? Math.round(w.reduce((a, b) => a + b, 0) / w.length) : 0;
  const bucket = { '<300': 0, '300-800': 0, '800-1500': 0, '1500+': 0 };
  for (const n of w) {
    if (n < 300) bucket['<300']++;
    else if (n < 800) bucket['300-800']++;
    else if (n < 1500) bucket['800-1500']++;
    else bucket['1500+']++;
  }

  console.log('='.repeat(72));
  console.log('CONTENT / SEO AUDIT');
  console.log('='.repeat(72));
  console.log(
    `pages built ${all.length} | content pages ${real.length} ` +
      `(excluded: ${EXCLUDED.map(String).join(', ')})`
  );
  console.log(`words total ${w.reduce((a, b) => a + b, 0).toLocaleString()} | median ${median} | mean ${mean}`);
  console.log(`depth buckets ${JSON.stringify(bucket)}`);

  // 1. Is content effort inverted against commercial value?
  console.log('\n--- 1. depth by page family (median / min / max) ---');
  for (const [label, re] of FAMILIES) {
    const g = real.filter((p) => re.test(p.route)).map((p) => words(p.text)).sort((a, b) => a - b);
    if (!g.length) continue;
    console.log(
      `  ${pad(label, 40)} n=${num(g.length, 3)}  median ${num(g[Math.floor(g.length / 2)], 5)}` +
        `  range ${g[0]}-${g[g.length - 1]}`
    );
  }

  console.log('\n--- thinnest 12 content pages ---');
  for (const p of [...real].sort((a, b) => words(a.text) - words(b.text)).slice(0, 12)) {
    console.log(`  ${num(words(p.text), 5)} words  ${p.route}`);
  }

  // 2. E-E-A-T. A hit rate of 0/N on a money family is the headline.
  console.log('\n--- 2. first-party experience signals by family ---');
  for (const [label, re] of FAMILIES) {
    const g = real.filter((p) => re.test(p.route));
    const hit = g.filter((p) => (p.text.match(EXPERIENCE) || []).length > 0);
    const flag = hit.length === 0 && g.length > 0 ? '  <-- 0/N, actionable' : '';
    console.log(`  ${pad(label, 40)} ${num(hit.length, 3)}/${num(g.length, 3)}${flag}`);
  }

  // 3. Internal link graph.
  const inbound = {};
  for (const p of real) {
    for (const t of new Set(internalLinks(p.html).map(normalize))) {
      inbound[t] = (inbound[t] || 0) + 1;
    }
  }
  const counts = Object.values(inbound);
  const zeroIn = real.filter((p) => !inbound[normalize(p.route)]);
  const navLike = Object.entries(inbound).filter(([, c]) => c >= real.length * 0.9);
  console.log('\n--- 3. internal link graph ---');
  console.log(`  distinct targets ${Object.keys(inbound).length} | inbound median ${counts.length ? [...counts].sort((a, b) => a - b)[Math.floor(counts.length / 2)] : 0} | max ${Math.max(0, ...counts)}`);
  console.log(`  targets linked from >=90% of pages (i.e. the nav): ${navLike.length}`);
  console.log(`  pages with ZERO inbound internal links: ${zeroIn.length}`);
  for (const p of zeroIn) console.log(`      ${p.route}`);

  // Nav share per page. The whole-page link count is misleading; the body count
  // is the one that decides whether authority can flow to money pages.
  console.log('\n--- nav chrome share (body links are what matter) ---');
  for (const route of ['/', '/category/defi/', '/compare/binance-vs-coinbase/', '/verify/binance/', '/learn/what-is-defi/', '/chain/ethereum/']) {
    const p = all.find((x) => x.route === route);
    if (!p) continue;
    const head = p.html.slice(0, p.html.indexOf('</header>'));
    const mainStart = p.html.indexOf('<main');
    const mainEnd = p.html.indexOf('</main>');
    const body = internalLinks(mainStart >= 0 && mainEnd > mainStart ? p.html.slice(mainStart, mainEnd) : p.html);
    const total = internalLinks(p.html).length;
    const chrome = total - internalLinks(p.html.slice(mainStart, mainEnd)).length;
    const pct = total ? Math.round((chrome / total) * 100) : 0;
    console.log(
      `  ${pad(route, 32)} total ${num(total, 4)} | chrome ${num(chrome, 4)} (${num(pct, 3)}%)` +
        ` | body ${num(body.length, 4)} uniq ${new Set(body.map(normalize)).size}`
    );
  }

  // 4. Content-to-markup ratio. Below ~15 words/KB the page is template-dominated.
  console.log('\n--- 4. content-to-markup ratio (words per KB; <15 = template-dominated) ---');
  const ratios = real
    .map((p) => ({ route: p.route, r: words(p.text) / KB(p.html), kb: KB(p.html), w: words(p.text) }))
    .sort((a, b) => a.r - b.r);
  const rm = ratios.map((x) => x.r);
  console.log(`  median ${rm[Math.floor(rm.length / 2)].toFixed(1)} | below 15: ${rm.filter((x) => x < 15).length}/${rm.length}`);
  for (const x of ratios.slice(0, 6)) {
    console.log(`      ${x.r.toFixed(1)}  ${num(x.kb.toFixed(0), 4)}KB / ${num(x.w, 5)} words  ${x.route}`);
  }

  // 5. Where does the markup actually go? Tag bytes vs prose bytes.
  console.log('\n--- 5. markup vs prose on the heaviest pages ---');
  for (const p of [...real].sort((a, b) => KB(b.html) - KB(a.html)).slice(0, 4)) {
    const h = p.html;
    const tagBytes = [...h.matchAll(/<[^>]+>/g)].reduce((s, m) => s + m[0].length, 0);
    const clsBytes = [...h.matchAll(/\sclass="[^"]*"/g)].reduce((s, m) => s + m[0].length, 0);
    const imgs = [...h.matchAll(/<img[\s>]/g)].length;
    const imgsWithDims = [...h.matchAll(/<img[^>]*\bwidth=/g)].length;
    const totalKb = KB(h);
    const tagKb = tagBytes / 1024;
    console.log(
      `  ${pad(p.route, 26)} ${num(totalKb.toFixed(0), 4)}KB | tags ${num(tagKb.toFixed(0), 4)}KB` +
        ` | class= ${num((clsBytes / 1024).toFixed(0), 3)}KB | prose ${num((totalKb - tagKb).toFixed(0), 4)}KB`
    );
    console.log(`      <img> ${imgs}, with width= ${imgsWithDims}${imgs && !imgsWithDims ? '  <-- CLS' : ''}`);
  }

  // 6. Meta hygiene.
  console.log('\n--- 6. meta hygiene ---');
  const meta = all.map((p) => {
    const t = p.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || '';
    const d = p.html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i)?.[1] || '';
    const h1 = (p.html.match(/<h1[\s>]/g) || []).length;
    return { route: p.route, tl: t.length, dl: d.length, d, h1 };
  });
  const dupDesc = {};
  for (const m of meta) if (m.dl > 0) (dupDesc[m.d] ||= []).push(m.route);
  const dupGroups = Object.values(dupDesc).filter((g) => g.length > 1);
  console.log(`  title >65: ${meta.filter((m) => m.tl > 65).length} | <25: ${meta.filter((m) => m.tl < 25).length}`);
  console.log(`  description >160: ${meta.filter((m) => m.dl > 160).length} | <70: ${meta.filter((m) => m.dl < 70).length}`);
  console.log(`  duplicate description groups: ${dupGroups.length}`);
  console.log(`  no H1: ${meta.filter((m) => m.h1 === 0).length} | multiple H1: ${meta.filter((m) => m.h1 > 1).length}`);

  console.log('\nDone. This script never fails the build on purpose.');
}
