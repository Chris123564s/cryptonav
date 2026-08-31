// Crawls every URL in the built sitemap, extracts internal links, and reports
// any that do not return 200. Use against the live site:
//   node scripts/check-live-links.mjs https://cryptonav.site
//
// Notes learned the hard way:
//  - 308 is Cloudflare Pages' trailing-slash redirect, not a failure (use -L).
//  - /cdn-cgi/l/email-protection is Cloudflare's email obfuscation, not a link.
//  - Do not guess URLs: /project/* and sub-category pages do not exist by
//    design, so guessing produces dozens of fake 404s.
const BASE = (process.argv[2] || 'https://cryptonav.site').replace(/\/$/, '');

const SKIP = [/^\/cdn-cgi\//, /^\/admin/, /^\/_astro\//];
const isAsset = (u) => /\.(png|jpe?g|svg|ico|css|js|xml|txt|json|webmanifest|woff2?)$/i.test(u);

async function get(url) {
  const res = await fetch(url, { redirect: 'follow' });
  const body = await res.text();
  return { status: res.status, body };
}

const index = await get(`${BASE}/sitemap-index.xml`);
const sitemaps = [...index.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

const urls = new Set();
for (const sm of sitemaps) {
  const r = await get(sm);
  for (const m of r.body.matchAll(/<loc>([^<]+)<\/loc>/g)) urls.add(m[1]);
}
console.log(`sitemap urls: ${urls.size}`);

const links = new Set();
for (const u of urls) {
  let r;
  try { r = await get(u); } catch (e) { console.log(`FETCH FAIL ${u}: ${e.message}`); continue; }
  if (r.status !== 200) console.log(`!! ${r.status} (sitemap) ${u}`);
  for (const m of r.body.matchAll(/href="([^"]+)"/g)) {
    let href = m[1];
    if (href.startsWith('http') && !href.startsWith(BASE)) continue;
    if (href.startsWith('http')) href = href.slice(BASE.length);
    if (!href.startsWith('/')) continue;
    href = href.split('#')[0].split('?')[0];
    if (!href || isAsset(href)) continue;
    if (SKIP.some((re) => re.test(href))) continue;
    links.add(href.replace(/\/$/, '') || '/');
  }
}

console.log(`internal links found: ${links.size}`);
let bad = 0;
for (const href of [...links].sort()) {
  let r;
  try { r = await get(BASE + href); } catch (e) { console.log(`!! ERR  ${href}: ${e.message}`); bad++; continue; }
  if (r.status !== 200) { console.log(`!! ${r.status}  ${href}`); bad++; }
}
console.log(bad === 0 ? 'no dead internal links' : `${bad} dead internal link(s)`);
process.exit(bad === 0 ? 0 : 1);
