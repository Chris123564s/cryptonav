// Smoke-test the built output for the FAQ + newsletter work.
import fs from 'node:fs';

function read(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

const checks = [];
const check = (name, got, want) => {
  const ok = String(got) === String(want);
  checks.push({ ok, name, got, want });
};

const faq = read('dist/faq/index.html');
const news = read('dist/newsletter/index.html');
const home = read('dist/index.html');

check('faq page built', !!faq, true);
check('newsletter page built', !!news, true);

// FAQ
check('faq JSON-LD present', /application\/ld\+json/.test(faq), true);
check('faq JSON-LD is FAQPage', /"@type":"FAQPage"/.test(faq), true);
const ldMatch = faq.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
let qCount = 0;
if (ldMatch) {
  try {
    const ld = JSON.parse(ldMatch[1]);
    qCount = ld.mainEntity.length;
    check('faq JSON-LD parses', true, true);
    check('faq answers have text', ld.mainEntity.every((q) => q.acceptedAnswer.text.length > 40), true);
  } catch { check('faq JSON-LD parses', false, true); }
}
check('faq question count', qCount, 24);
check('faq uses details/summary', (faq.match(/<details/g) || []).length, 24);
check('faq group anchors', (faq.match(/<section id="/g) || []).length, 5);

// Newsletter
check('newsletter has subscribe form', /class="subscribe-form/.test(news), true);
check('newsletter honeypot present', /name="website"/.test(news), true);

// The submit handler lives in the hoisted bundle, not inline in the HTML.
const chunk = (news.match(/\/_astro\/hoisted\.[A-Za-z0-9_-]+\.js/) || [])[0];
const chunkSrc = chunk ? read('dist' + chunk) : '';
check('newsletter references a hoisted chunk', !!chunk, true);
check('bundle posts to /api/subscribe', /\/api\/subscribe/.test(chunkSrc), true);
check('bundle handles unconfigured fallback', /unconfigured/.test(chunkSrc), true);
check('bundle handles honeypot', /name="website"|website/.test(chunkSrc), true);

// Footer placement (footer appears on every page)
check('footer links to /faq', /href="\/faq"/.test(home), true);
check('footer links to /newsletter', /href="\/newsletter"/.test(home), true);
check('footer has compact subscribe form', /data-source="footer"/.test(home), true);

// Sitemap
const sm = read('dist/sitemap-0.xml');
check('sitemap lists /faq', sm.includes('/faq/'), true);
check('sitemap lists /newsletter', sm.includes('/newsletter/'), true);

let pass = 0;
for (const c of checks) {
  if (c.ok) pass++;
  else console.log(`FAIL  ${c.name}  (got ${c.got}, want ${c.want})`);
}
console.log(`${pass}/${checks.length} passed`);
process.exit(pass === checks.length ? 0 : 1);
