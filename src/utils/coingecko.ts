/**
 * Base URL for CoinGecko calls made from the browser.
 *
 * In production we go through our own Cloudflare Pages Function
 * (`functions/api/cg/[[path]].js`), which caches responses at the edge and
 * serves "last known good" data when CoinGecko rate-limits us. Calling the
 * upstream API directly meant every visitor burned their own rate-limit
 * budget, so charts and tickers showed "—" most of the time.
 *
 * `astro dev` does not run Pages Functions, so on localhost we fall back to
 * the direct API (use `wrangler pages dev` if you need the proxy locally).
 */
export const CG_BASE: string =
  typeof location !== 'undefined' &&
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'https://api.coingecko.com/api/v3'
    : '/api/cg';
