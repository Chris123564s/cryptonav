/**
 * SEO metadata gate for the built site.
 *
 * Runs against `dist/`, not against source, because what matters is the HTML
 * Google actually receives. That catches the two failure modes that source-level
 * review cannot: a page that forgot to pass a description through the layout,
 * and a title that only looks short until the HTML entities are decoded.
 *
 * Entities are decoded before measuring. `&amp;` is five characters of source
 * and one character of rendered text; measuring raw would flag a perfectly good
 * title and let a genuinely overlong one through.
 *
 * Routes under /embed/ are exempt. They are iframe payloads served with
 * `noindex`, not pages competing in search results.
 */

import fs from 'node:fs';
import path from 'node:path';

const DIST = 'dist';
const EXEMPT_PREFIXES = ['/embed/'];
const EXEMPT_ROUTES = new Set(['/admin']);

const TITLE_MIN = 25;
const TITLE_MAX = 60;
const DESC_MIN = 70;
const DESC_MAX = 160;

let pass = 0;
const failures = [];

function fail(route, message) {
  failures.push(`${route} — ${message}`);
}
function ok() {
  pass += 1;
}

/** Decode the entities that actually appear in Astro's escaped output. */
function decode(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#0*38;/g, '&')
    .replace(/&amp;/g, '&');
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (p.endsWith('.html')) out.push(p);
  }
  return out;
}

/** /dist/verify/binance/index.html -> /verify/binance/ */
function toRoute(file) {
  let r = path.relative(DIST, file).split(path.sep).join('/');
  r = r.replace(/\/(index)?\.html$/, '');
  return r.startsWith('/') ? r : `/${r}`;
}

function readMeta(html) {
  const titleRaw = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] ?? '';
  const tag = html.match(/<meta[^>]+name=["']description["'][^>]*>/);
  // The delimiter must be captured and reused. `[^"']*` would stop dead at the
  // apostrophe in "cryptocurrency's", silently measuring a 197-char description
  // as 36 chars and reporting a false "too short" failure.
  const descRaw = tag ? (tag[0].match(/content=(["'])([\s\S]*?)\1/) || [])[2] ?? '' : '';
  const robotsRaw = html.match(/<meta[^>]+name=["']robots["'][^>]+content=(["'])([\s\S]*?)\1/);
  const robots = robotsRaw ? robotsRaw[2] : '';
  return {
    title: decode(titleRaw).trim(),
    desc: decode(descRaw).trim(),
    hasDescTag: Boolean(tag),
    noindex: /noindex/i.test(robots),
  };
}

if (!fs.existsSync(DIST)) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

const pages = walk(DIST)
  .map((file) => ({ route: toRoute(file), ...readMeta(fs.readFileSync(file, 'utf8')) }))
  .filter((p) => !EXEMPT_PREFIXES.some((x) => p.route.startsWith(x)))
  .filter((p) => !EXEMPT_ROUTES.has(p.route));

if (pages.length === 0) {
  console.error('No pages found in dist/.');
  process.exit(1);
}

for (const p of pages) {
  if (!p.title) fail(p.route, 'missing <title>');
  else if (p.title.length > TITLE_MAX) fail(p.route, `title is ${p.title.length} chars (max ${TITLE_MAX}): ${p.title}`);
  else if (p.title.length < TITLE_MIN) fail(p.route, `title is ${p.title.length} chars (min ${TITLE_MIN}): ${p.title}`);
  else ok();

  // A noindex page is allowed to omit a description; it is not competing for a snippet.
  if (!p.hasDescTag && !p.noindex) fail(p.route, 'missing <meta name="description">');
  else if (!p.hasDescTag) ok();
  else if (p.desc.length > DESC_MAX) fail(p.route, `description is ${p.desc.length} chars (max ${DESC_MAX}): ${p.desc}`);
  else if (p.desc.length < DESC_MIN) fail(p.route, `description is ${p.desc.length} chars (min ${DESC_MIN}): ${p.desc}`);
  else ok();

  // Trailing " | CryptoNav" on the title, or its absence, should be deliberate per section.
  if (p.title.includes('CryptoNav') && p.route !== '/' && p.title.length > TITLE_MAX) {
    fail(p.route, 'brand suffix pushes an already-long title past the limit — shorten the page-specific part');
  } else ok();
}

// Duplicate metadata across pages means two pages are competing for the same query.
function duplicates(key) {
  const seen = new Map();
  for (const p of pages) {
    const v = p[key];
    if (!v) continue;
    if (!seen.has(v)) seen.set(v, []);
    seen.get(v).push(p.route);
  }
  return [...seen.entries()].filter(([, routes]) => routes.length > 1);
}

for (const [title, routes] of duplicates('title')) {
  fail(routes.join(', '), `duplicate title: "${title}"`);
}
for (const [desc, routes] of duplicates('desc')) {
  fail(routes.join(', '), `duplicate description: "${desc}"`);
}
ok();

console.log(`Pages checked: ${pages.length}`);
console.log(`Assertions passed: ${pass}`);
if (failures.length) {
  console.log(`\nFAILURES (${failures.length}):`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('All metadata checks passed.');
