// Crawls every URL in the built sitemap, extracts internal links, and reports
// any that do not return 200. Use against the live site:
//   node scripts/check-live-links.mjs https://cryptonav.site
//
// Exits 1 if any URL fails, 0 if all are fine -- that exit code is the only
// thing .github/workflows/check-links.yml keys off, so a silent "printed a
// warning but passed" path would defeat the point of running it on a schedule.
//
// Notes learned the hard way:
//  - 308 is Cloudflare Pages' trailing-slash redirect, not a failure (use -L).
//  - /cdn-cgi/l/email-protection is Cloudflare's email obfuscation, not a link.
//  - Do not guess URLs: /project/* and sub-category pages do not exist by
//    design, so guessing produces dozens of fake 404s.
//  - A 5xx is retried before it is reported. Pages Functions talk to CoinGecko
//    upstream on every cold cache entry; one upstream hiccup is not a dead
//    link, and a weekly job that cries wolf gets ignored.
//  - Every request has a hard timeout. Sequential fetches with no timeout turn
//    one hung response into a job that sits there until GitHub kills it at the
//    workflow timeout, which looks nothing like a link failure.
//  - Crawl depth is ONE: hrefs are extracted only from pages the sitemap
//    lists, and the crawl does not follow its own findings. Every internal
//    destination reachable from an indexed page is therefore verified, but a
//    dead link emitted only by a page missing from the sitemap stays
//    invisible. Going deeper means BFS, which roughly doubles the runtime
//    (110 URLs already takes 4-5 minutes). Deliberately not done; asserted in
//    scripts/test-link-checker.mjs so the behaviour cannot change silently.
const BASE = (process.argv[2] || 'https://cryptonav.site').replace(/\/$/, '');

const SKIP = [/^\/cdn-cgi\//, /^\/admin/, /^\/_astro\//];
const isAsset = (u) => /\.(png|jpe?g|svg|ico|css|js|xml|txt|json|webmanifest|woff2?)$/i.test(u);

const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;

// Some CDNs answer the default Node UA with a challenge. Identify the crawler.
const HEADERS = { 'user-agent': 'CryptoNav-LinkCheck/1.0 (+internal link audit)' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  for (let attempt = 1; ; attempt++) {
    // An explicit AbortController, cleared in `finally` -- NOT
    // AbortSignal.timeout(). AbortSignal.timeout() leaves a pending timer
    // handle behind, and on Node 24 / Windows that trips a libuv assertion at
    // process exit:
    //     Assertion failed: !(handle->flags & UV_HANDLE_CLOSING),
    //     file src\win\async.c, line 76
    // The crash replaces the exit code with 127 for BOTH outcomes, so a
    // healthy crawl would fail the scheduled job every week. Clearing the
    // timer ourselves is the fix; it costs three lines.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { redirect: 'follow', headers: HEADERS, signal: ac.signal });
      const body = await res.text();
      // Retry only 5xx. A 404 is a real answer and retrying it just slows
      // the crawl down; 429 is not retried either -- backing off against a
      // rate limit is a different tool than this.
      if (res.status >= 500 && attempt < MAX_ATTEMPTS) {
        await sleep(1000 * attempt);
        continue;
      }
      return { status: res.status, body };
    } catch (e) {
      if (attempt >= MAX_ATTEMPTS) return { status: 0, body: '', error: e.message };
      await sleep(1000 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
}

let bad = 0;
const fail = (label, r) => {
  bad++;
  console.log(`!! ${r.status || 'ERR'}  ${label}${r.error ? ` (${r.error})` : ''}`);
};

const index = await get(`${BASE}/sitemap-index.xml`);
if (index.status !== 200) fail(`${BASE}/sitemap-index.xml`, index);
const sitemaps = [...index.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (sitemaps.length === 0) {
  bad++;
  console.log('!! sitemap-index.xml listed no child sitemaps -- nothing to crawl');
}

const urls = new Set();
for (const sm of sitemaps) {
  const r = await get(sm);
  // A child sitemap that 404s is itself a defect worth failing on, and it
  // silently shrinks the crawl: fewer URLs found, fewer links checked, and a
  // green job that covered less of the site than last week.
  if (r.status !== 200) fail(`${sm} (sitemap)`, r);
  for (const m of r.body.matchAll(/<loc>([^<]+)<\/loc>/g)) urls.add(m[1]);
}
console.log(`sitemap urls: ${urls.size}`);

const links = new Set();
for (const u of urls) {
  const r = await get(u);
  // Counted, not just printed: a page in the sitemap that no longer resolves
  // is exactly what this audit exists to catch.
  if (r.status !== 200) fail(`${u} (sitemap)`, r);
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

// Zero links means the crawl extracted nothing, which is a broken audit rather
// than a clean site. Every page here carries a header and footer full of
// internal hrefs, so a real run always finds dozens.
if (links.size === 0) {
  bad++;
  console.log('!! found no internal links at all -- the crawl itself is broken');
} else {
  for (const href of [...links].sort()) {
    const r = await get(BASE + href);
    if (r.status !== 200) fail(href, r);
  }
}

console.log(bad === 0 ? 'no dead internal links' : `${bad} dead internal link(s)`);

// Set exitCode and fall off the end of the script. Do NOT call process.exit().
//
// process.exit() tears the process down while undici's keep-alive sockets are
// still open, and on Node 24 / Windows that aborts inside libuv:
//     Assertion failed: !(handle->flags & UV_HANDLE_CLOSING),
//     file src\win\async.c, line 76
// The exit code then comes out as 127 -- for BOTH the passing and the failing
// case. That is not a cosmetic wart: this script's exit code is the only
// signal check-links.yml uses, so a green crawl would have failed the
// scheduled job every single week. Measured on 2026-09-04; the original
// version had this bug too, it just never had its exit code checked.
process.exitCode = bad === 0 ? 0 : 1;
