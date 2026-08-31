/**
 * Verifies the JSON-LD structured data emitted into dist/.
 *
 * Run after `npm run build`:  node scripts/check-jsonld.mjs
 *
 * Why this exists: structured data fails silently. A typo in a helper produces
 * perfectly valid HTML that Google simply ignores, and nothing in the build
 * complains. These assertions catch the regressions that matter — invalid JSON,
 * missing required Article fields, relative URLs, empty ItemLists, broken
 * breadcrumb ordering, and script-tag breakout.
 */
import fs from 'node:fs';
import path from 'node:path';

const DIST = 'dist';
let pass = 0;
const failures = [];

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else failures.push(`${name}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`);
}

function ok(name, cond, detail = '') {
  if (cond) pass++;
  else failures.push(`${name}${detail ? `\n      ${detail}` : ''}`);
}

/** Recursively collect index.html files under dist. */
function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, acc);
    else if (entry.name === 'index.html') acc.push(p);
  }
  return acc;
}

const pages = walk(DIST);
ok('dist has built pages', pages.length > 30, `found ${pages.length}`);

/** Extract and parse every ld+json block in one page. */
function extractLd(html) {
  const blocks = [];
  const re = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) blocks.push(m[1]);
  return blocks.map((raw) => {
    try {
      return { ok: true, node: JSON.parse(raw) };
    } catch (e) {
      return { ok: false, raw, error: e.message };
    }
  });
}

/** Flatten a node (or @graph) into a list of typed nodes. */
function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node['@graph'])) return node['@graph'].flatMap(nodes);
  return [node];
}

const byPath = new Map();

for (const file of pages) {
  const html = fs.readFileSync(file, 'utf8');
  const route = '/' + path.relative(DIST, path.dirname(file)).split(path.sep).join('/');
  const parsed = extractLd(html);
  const typed = parsed.flatMap((p) => (p.ok ? nodes(p.node) : []));
  byPath.set(route === '/' ? '/' : '/' + route.replace(/^\//, ''), {
    file,
    html,
    blocks: parsed,
    types: typed.map((n) => n['@type']),
    typed,
  });
}

// ---------------------------------------------------------------------------
// 1. Every built page carries at least one parseable ld+json block
// ---------------------------------------------------------------------------
// Routes that are plain static HTML copied from public/ and never go through
// Layout.astro — they are not expected to carry structured data.
const NON_ASTRO_ROUTES = new Set(['/404', '/admin']);
// /embed/* is iframe payload: a bare document with no Layout, no navigation and
// `noindex`. Expecting structured data there would be pointless.
const NON_ASTRO_PREFIXES = ['/embed/'];

const isExempt = (route) =>
  NON_ASTRO_ROUTES.has(route) || NON_ASTRO_PREFIXES.some((p) => route.startsWith(p));

for (const [route, page] of byPath) {
  if (isExempt(route)) continue;
  ok(`[${route}] has JSON-LD`, page.blocks.length >= 1, `${page.blocks.length} blocks`);
  for (const b of page.blocks) {
    ok(`[${route}] JSON-LD parses`, b.ok, b.error || '');
  }
}

// ---------------------------------------------------------------------------
// 2. No raw "</script" anywhere inside an ld+json payload (escaping works)
// ---------------------------------------------------------------------------
for (const [route, page] of byPath) {
  for (const b of page.blocks) {
    ok(`[${route}] no script breakout`, !/<\/script/i.test(b.raw ?? ''), 'unescaped </script in payload');
  }
}

// ---------------------------------------------------------------------------
// 3. Page-type coverage
// ---------------------------------------------------------------------------
const coverage = [
  { route: '/', expect: ['Organization', 'WebSite', 'ItemList'] },
  { route: '/faq', expect: ['FAQPage', 'BreadcrumbList'] },
  { route: '/learn', expect: ['CollectionPage', 'ItemList', 'BreadcrumbList'] },
  { route: '/compare', expect: ['CollectionPage', 'ItemList', 'BreadcrumbList'] },
  { route: '/airdrops', expect: ['CollectionPage', 'BreadcrumbList'] },
  { route: '/unlocks', expect: ['CollectionPage', 'BreadcrumbList'] },
  { route: '/dashboard', expect: ['BreadcrumbList'] },
  { route: '/about', expect: ['BreadcrumbList'] },
  { route: '/privacy', expect: ['BreadcrumbList'] },
  { route: '/terms', expect: ['BreadcrumbList'] },
  { route: '/submit', expect: ['BreadcrumbList'] },
  { route: '/advertise', expect: ['BreadcrumbList'] },
  { route: '/newsletter', expect: ['BreadcrumbList'] },
  { route: '/learn/what-is-staking-crypto', expect: ['Article', 'BreadcrumbList'] },
  { route: '/compare/binance-vs-coinbase', expect: ['Article', 'BreadcrumbList'] },
  { route: '/category/exchange', expect: ['CollectionPage', 'ItemList', 'BreadcrumbList'] },
  { route: '/chain/ethereum', expect: ['CollectionPage', 'ItemList', 'BreadcrumbList'] },
];

for (const { route, expect } of coverage) {
  const page = byPath.get(route);
  ok(`route exists: ${route}`, Boolean(page), 'page not found in dist — route name changed?');
  if (!page) continue;
  for (const type of expect) {
    ok(`[${route}] emits ${type}`, page.types.includes(type), `types: ${[...new Set(page.types)].join(', ')}`);
  }
}

// ---------------------------------------------------------------------------
// 4. Every learn / compare / category / chain route (not just the samples)
// ---------------------------------------------------------------------------
for (const [route, page] of byPath) {
  if (/^\/learn\/[^/]+$/.test(route)) {
    ok(`[${route}] Article`, page.types.includes('Article'), `types: ${page.types.join(', ')}`);
    ok(`[${route}] BreadcrumbList`, page.types.includes('BreadcrumbList'));
  }
  if (/^\/compare\/[^/]+$/.test(route)) {
    ok(`[${route}] Article`, page.types.includes('Article'), `types: ${page.types.join(', ')}`);
  }
  if (/^\/category\/[^/]+$/.test(route)) {
    ok(`[${route}] CollectionPage`, page.types.includes('CollectionPage'));
    ok(`[${route}] ItemList`, page.types.includes('ItemList'));
  }
  if (/^\/chain\/[^/]+$/.test(route)) {
    ok(`[${route}] CollectionPage`, page.types.includes('CollectionPage'));
    ok(`[${route}] ItemList`, page.types.includes('ItemList'));
  }
}

// ---------------------------------------------------------------------------
// 5. Article nodes carry Google's required/recommended fields
// ---------------------------------------------------------------------------
for (const [route, page] of byPath) {
  for (const node of page.typed) {
    if (node['@type'] !== 'Article') continue;
    ok(`[${route}] Article.headline`, typeof node.headline === 'string' && node.headline.length > 0);
    ok(
      `[${route}] Article.headline <= 110 chars`,
      (node.headline || '').length <= 110,
      `len ${(node.headline || '').length}`,
    );
    ok(`[${route}] Article.datePublished ISO`, /^\d{4}-\d{2}-\d{2}/.test(node.datePublished || ''), node.datePublished);
    ok(`[${route}] Article.dateModified set`, Boolean(node.dateModified), 'missing dateModified');
    ok(`[${route}] Article.author`, Boolean(node.author && node.author.name), JSON.stringify(node.author));
    ok(`[${route}] Article.publisher @id`, node.publisher?.['@id']?.includes('#organization'), JSON.stringify(node.publisher));
    ok(`[${route}] Article.image`, Boolean(node.image), 'missing image');
    ok(`[${route}] Article.url absolute`, /^https:\/\//.test(node.url || ''), node.url);
    ok(`[${route}] Article.inLanguage`, node.inLanguage === 'en', node.inLanguage);
  }
}

// ---------------------------------------------------------------------------
// 6. BreadcrumbList shape
// ---------------------------------------------------------------------------
for (const [route, page] of byPath) {
  for (const node of page.typed) {
    if (node['@type'] !== 'BreadcrumbList') continue;
    const items = node.itemListElement || [];
    ok(`[${route}] breadcrumb non-empty`, items.length >= 1);
    items.forEach((it, i) => {
      ok(`[${route}] crumb ${i} position`, it.position === i + 1, `got ${it.position}`);
      ok(`[${route}] crumb ${i} has name`, typeof it.name === 'string' && it.name.length > 0);
    });
    const last = items[items.length - 1];
    ok(`[${route}] last crumb has no item (current page)`, !('item' in last), JSON.stringify(last));
    for (const it of items.slice(0, -1)) {
      ok(`[${route}] crumb "${it.name}" item is absolute`, /^https:\/\//.test(it.item || ''), it.item);
    }
  }
}

// ---------------------------------------------------------------------------
// 7. ItemList shape — never empty, always absolute URLs
// ---------------------------------------------------------------------------
let itemListCount = 0;
for (const [route, page] of byPath) {
  for (const node of page.typed) {
    if (node['@type'] !== 'ItemList') continue;
    itemListCount++;
    const items = node.itemListElement || [];
    ok(`[${route}] ItemList "${node.name}" not empty`, items.length > 0, `numberOfItems=${node.numberOfItems}`);
    check(`[${route}] ItemList "${node.name}" numberOfItems matches`, node.numberOfItems, items.length);
    for (const it of items) {
      ok(`[${route}] ItemList url absolute`, /^https?:\/\//.test(it.url || ''), it.url);
      ok(`[${route}] ItemList item has name`, Boolean(it.name), JSON.stringify(it));
    }
    items.forEach((it, i) => {
      ok(`[${route}] ItemList position ${i}`, it.position === i + 1, `got ${it.position}`);
    });
  }
}
ok('site has ItemLists', itemListCount >= 8, `found ${itemListCount}`);

// ---------------------------------------------------------------------------
// 8. Organization / WebSite live only on the homepage (no duplication)
// ---------------------------------------------------------------------------
let orgPages = 0;
for (const [, page] of byPath) {
  if (page.types.includes('Organization')) orgPages++;
}
check('Organization appears on exactly 1 page (home)', orgPages, 1);

const home = byPath.get('/');
const org = home?.typed.find((n) => n['@type'] === 'Organization');
ok('Organization has logo', Boolean(org?.logo?.url), JSON.stringify(org?.logo));
ok('Organization has @id', (org?.['@id'] || '').includes('#organization'));

const site = home?.typed.find((n) => n['@type'] === 'WebSite');
ok('WebSite has publisher ref', site?.publisher?.['@id']?.includes('#organization'), JSON.stringify(site?.publisher));
ok(
  'WebSite has no SearchAction (no server-side search exists)',
  !site?.potentialAction,
  'potentialAction present but /search does not exist',
);

// ---------------------------------------------------------------------------
// 9. FAQPage still carries every question
// ---------------------------------------------------------------------------
const faq = byPath.get('/faq');
const faqNode = faq?.typed.find((n) => n['@type'] === 'FAQPage');
ok('FAQPage present', Boolean(faqNode));
if (faqNode) {
  ok('FAQPage has questions', (faqNode.mainEntity || []).length >= 20, `${(faqNode.mainEntity || []).length} questions`);
  for (const q of faqNode.mainEntity || []) {
    ok('FAQ question has answer text', Boolean(q.acceptedAnswer?.text), q.name);
  }
}

// ---------------------------------------------------------------------------
// 10. Emitted item URLs must not point at routes we do not build
//     (e.g. /project/* — there is no project detail page)
// ---------------------------------------------------------------------------
const builtRoutes = new Set(byPath.keys());
for (const [route, page] of byPath) {
  for (const node of page.typed) {
    if (node['@type'] !== 'ItemList') continue;
    for (const it of node.itemListElement || []) {
      if (!/^https:\/\/cryptonav\.site\//.test(it.url || '')) continue; // external links are fine
      const p = new URL(it.url).pathname.replace(/\/$/, '') || '/';
      ok(`[${route}] internal item URL exists: ${p}`, builtRoutes.has(p), 'dead internal URL in structured data');
    }
  }
}

// ---------------------------------------------------------------------------
console.log(`\nJSON-LD check: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('All JSON-LD assertions passed.');

// Summary of what is on the site
const summary = new Map();
for (const [, page] of byPath) {
  for (const t of new Set(page.types)) summary.set(t, (summary.get(t) || 0) + 1);
}
console.log('\nStructured data coverage:');
for (const [t, n] of [...summary.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${t.padEnd(16)} ${n} pages`);
}
console.log(`  ${'—'.repeat(26)}\n  ${byPath.size} pages crawled`);
