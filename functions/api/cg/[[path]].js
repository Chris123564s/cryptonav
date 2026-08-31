// Cloudflare Pages Function: /api/cg/*
//
// A cached reverse proxy in front of the CoinGecko public API.
//
// WHY THIS EXISTS
// ---------------
// The browser used to call api.coingecko.com directly. CoinGecko's free tier is
// aggressively rate-limited (HTTP 429), so the MarketChart / TickerBar /
// dashboard widgets frequently failed and rendered "—". Worse, every visitor
// burned their OWN rate-limit budget, so the site got less reliable the more
// traffic it had.
//
// Routing everything through this function means:
//   1. One upstream call serves EVERY visitor (edge cache hit).
//   2. Concurrent misses are de-duplicated into a single upstream request.
//   3. If CoinGecko rate-limits or errors, we serve the last known good
//      response (up to 24h old) instead of an empty widget.
//
// No API key required. If you later add one, set the COINGECKO_API_KEY
// (Demo key) or COINGECKO_PRO_API_KEY (Pro key) env var in Cloudflare Pages
// and it will be attached automatically.

const UPSTREAM = 'https://api.coingecko.com/api/v3';

// Only these endpoints are proxied — this is NOT an open proxy.
const ALLOWED = [
  /^simple\/price$/,
  /^global$/,
  /^search\/trending$/,
  /^coins\/markets$/,
  /^coins\/[a-z0-9-]{1,64}\/market_chart$/,
];

// How long a response is considered fresh, per endpoint (seconds).
// Short windows for prices, long windows for history that barely moves.
function ttlFor(path, url) {
  if (path.includes('/market_chart')) {
    const days = Number(url.searchParams.get('days') || '1');
    if (days <= 1) return 300; // 5 min
    if (days <= 7) return 900; // 15 min
    if (days <= 30) return 1800; // 30 min
    return 21600; // 6 h — 1Y / max
  }
  if (path === 'simple/price') return 60;
  if (path === 'global') return 300;
  if (path === 'search/trending') return 600;
  if (path === 'coins/markets') return 300;
  return 300;
}

const STALE_TTL = 86400; // keep a 24h "last known good" copy for outages
const UPSTREAM_TIMEOUT = 8000; // ms

const cache = caches.default;

// De-duplicate concurrent misses: a burst of visitors must trigger ONE
// upstream request, not N (which would immediately trip the rate limiter).
const inflight = new Map();

function buildResponse(body, status, contentType, cacheControl, extra = {}) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': contentType || 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': cacheControl,
      ...extra,
    },
  });
}

function jsonError(message, status, extra = {}) {
  return buildResponse(JSON.stringify({ error: message }), status, 'application/json', 'no-store', extra);
}

// Reported as X-CG-Auth so you can confirm from a plain curl whether a key is
// wired up, without ever exposing the key itself.
function authMode(env) {
  if (env.COINGECKO_PRO_API_KEY) return 'pro-key';
  if (env.COINGECKO_API_KEY) return 'demo-key';
  return 'none';
}

async function fetchUpstream(url, env) {
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'cryptonav-site/1.0 (+https://cryptonav.site)',
  };
  // Optional API key — the proxy works fine without one, a key just raises the
  // rate limit. Pro wins over Demo if both happen to be set.
  if (env.COINGECKO_PRO_API_KEY) {
    headers['x-cg-pro-api-key'] = env.COINGECKO_PRO_API_KEY;
  } else if (env.COINGECKO_API_KEY) {
    headers['x-cg-demo-api-key'] = env.COINGECKO_API_KEY;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    const body = await res.text();
    return {
      status: res.status,
      body,
      contentType: res.headers.get('Content-Type') || 'application/json',
    };
  } finally {
    clearTimeout(timer);
  }
}

// Cloudflare Pages hands a multi-segment catch-all param over as an ARRAY of
// segments (['simple','price']), not a slash-joined string. String() would
// flatten that to "simple,price", which silently fails the allowlist — every
// endpoint except single-segment /global returned 403 on the live site.
function normalisePath(raw) {
  if (Array.isArray(raw)) return raw.join('/');
  const s = String(raw ?? '');
  // Defensive: some runtimes hand over "a,b" instead of "a/b".
  return s.includes('/') ? s : s.split(',').join('/');
}

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const path = normalisePath(params.path).replace(/^\/+|\/+$/g, '');

  if (!ALLOWED.some((re) => re.test(path))) {
    return jsonError('endpoint not allowed', 403);
  }

  const auth = authMode(env);
  const incoming = new URL(request.url);
  const upstreamUrl = `${UPSTREAM}/${path}${incoming.search}`;
  const ttl = ttlFor(path, incoming);
  const key = request.url;
  // NOTE: do NOT use a URL fragment here. The Cache API normalises fragments
  // away, which would make the "fresh" and "stale" keys collide.
  const staleKey = `${key}${key.includes('?') ? '&' : '?'}__cgStale=1`;

  // 1) Fresh cache hit — no upstream call at all.
  const fresh = await cache.match(key);
  if (fresh) {
    return buildResponse(fresh.body, 200, fresh.headers.get('Content-Type'), `public, max-age=${ttl}`, {
      'X-CG-Cache': 'HIT',
      'X-CG-Auth': auth,
    });
  }

  // 2) Miss — share one upstream request across all concurrent visitors.
  let pending = inflight.get(upstreamUrl);
  if (!pending) {
    pending = fetchUpstream(upstreamUrl, env).finally(() => inflight.delete(upstreamUrl));
    inflight.set(upstreamUrl, pending);
  }

  let result = null;
  let err = null;
  try {
    result = await pending;
  } catch (e) {
    err = e;
  }

  if (!err && result.status === 200) {
    const { body, contentType } = result;
    // Store twice: a short-lived "fresh" copy and a 24h "last known good"
    // copy we can fall back to when CoinGecko starts rejecting us.
    context.waitUntil(
      Promise.all([
        cache.put(key, buildResponse(body, 200, contentType, `public, max-age=${ttl}`)),
        cache.put(staleKey, buildResponse(body, 200, contentType, `public, max-age=${STALE_TTL}`)),
      ])
    );
    return buildResponse(body, 200, contentType, `public, max-age=${ttl}`, {
      'X-CG-Cache': 'MISS',
      'X-CG-Auth': auth,
    });
  }

  // 3) Upstream failed or rate-limited — serve the last known good response.
  const stale = await cache.match(staleKey);
  if (stale) {
    return buildResponse(stale.body, 200, stale.headers.get('Content-Type'), 'no-store', {
      'X-CG-Cache': 'STALE',
      'X-CG-Auth': auth,
    });
  }

  const status = err ? 504 : result.status === 429 ? 429 : 502;
  return jsonError(err ? 'upstream timeout' : 'upstream unavailable', status, {
    'X-CG-Auth': auth,
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400',
    },
  });
}
