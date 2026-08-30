/**
 * CoinGecko access for browser widgets.
 *
 * Production goes through our own Cloudflare Pages Function
 * (`functions/api/cg/[[path]].js`), which caches responses at the edge so one
 * upstream call serves every visitor.
 *
 * There is a catch: CoinGecko's free tier rate-limits by IP, and Cloudflare's
 * shared datacenter egress IPs are hammered by thousands of other Workers, so
 * the edge can be throttled even when we only make one request per hour. When
 * that happens we fall back to calling CoinGecko directly — the visitor's own
 * IP is rarely throttled. See `cgFetch`.
 *
 * `astro dev` does not run Pages Functions, so on localhost we call the
 * upstream API directly (use `wrangler pages dev` to test the proxy locally).
 */

const CG_DIRECT = 'https://api.coingecko.com/api/v3';

export const CG_BASE: string =
  typeof location !== 'undefined' &&
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? CG_DIRECT
    : '/api/cg';

/**
 * Set once the edge proxy proves unusable. Polling widgets (ticker, dashboard)
 * would otherwise waste a round trip every single interval.
 */
let edgeDown = false;

/**
 * GET a CoinGecko endpoint, preferring the cached edge proxy and falling back
 * to a direct call when the edge is rate-limited or broken.
 *
 * `path` must start with a slash, e.g. `/simple/price?ids=bitcoin`.
 */
export async function cgFetch(path: string, init?: RequestInit): Promise<Response> {
  if (CG_BASE === CG_DIRECT || edgeDown) {
    return fetch(CG_DIRECT + path, init);
  }

  let res: Response;
  try {
    res = await fetch(CG_BASE + path, init);
  } catch {
    // Proxy unreachable (offline, DNS, blocked) — go direct.
    edgeDown = true;
    return fetch(CG_DIRECT + path, init);
  }

  // 429 = edge IP throttled, 5xx = proxy/upstream trouble. Both are worth
  // retrying against our own IP. Any other 4xx is a real answer — keep it.
  if (res.status === 429 || res.status >= 500) {
    edgeDown = true;
    return fetch(CG_DIRECT + path, init);
  }
  return res;
}
