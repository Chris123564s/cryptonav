// Temporary harness: exercises functions/api/cg/[[path]].js with a fake
// Cloudflare Cache API + fake upstream so we can verify HIT / MISS / STALE /
// request-de-duplication without deploying.

const store = new Map();

globalThis.caches = {
  default: {
    async put(key, resp) {
      const cc = resp.headers.get('Cache-Control') || '';
      const m = /max-age=(\d+)/.exec(cc);
      const ttl = m ? Number(m[1]) * 1000 : 0;
      store.set(key, { resp: resp.clone(), expires: Date.now() + ttl });
    },
    async match(key) {
      const e = store.get(key);
      if (!e) return undefined;
      if (Date.now() > e.expires) {
        store.delete(key);
        return undefined;
      }
      return e.resp.clone();
    },
  },
};

let upstreamStatus = 200;
let upstreamCalls = 0;
globalThis.fetch = async () => {
  upstreamCalls++;
  if (upstreamStatus !== 200) {
    return new Response('rate limited', { status: upstreamStatus });
  }
  return new Response(JSON.stringify({ prices: [[1, 100]] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

const mod = await import('../functions/api/cg/[[path]].js');

function makeCtx(url, path) {
  const pending = [];
  return {
    ctx: {
      request: new Request(url),
      env: {},
      params: { path },
      waitUntil: (p) => pending.push(p),
    },
    flush: async () => {
      await Promise.all(pending);
    },
  };
}

async function call(url, path) {
  const { ctx, flush } = makeCtx(url, path);
  const res = await mod.onRequestGet(ctx);
  await flush();
  return res;
}

const BASE = 'https://cryptonav.site/api/cg';
const results = [];
function check(name, actual, expected) {
  const ok = actual === expected;
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${actual}, want ${expected})`);
}

// 1) cold miss -> upstream called, response cached
let r = await call(`${BASE}/coins/bitcoin/market_chart?vs_currency=usd&days=1`, 'coins/bitcoin/market_chart');
check('cold MISS -> X-CG-Cache', r.headers.get('X-CG-Cache'), 'MISS');
check('cold MISS -> upstream calls', upstreamCalls, 1);
check('cold MISS -> 200', r.status, 200);

// 2) warm hit -> no extra upstream call
r = await call(`${BASE}/coins/bitcoin/market_chart?vs_currency=usd&days=1`, 'coins/bitcoin/market_chart');
check('warm HIT -> X-CG-Cache', r.headers.get('X-CG-Cache'), 'HIT');
check('warm HIT -> upstream still 1', upstreamCalls, 1);

// 3) concurrent misses on the SAME url must collapse into one upstream call
upstreamCalls = 0;
const url2 = `${BASE}/coins/ethereum/market_chart?vs_currency=usd&days=7`;
const three = await Promise.all([
  call(url2, 'coins/ethereum/market_chart'),
  call(url2, 'coins/ethereum/market_chart'),
  call(url2, 'coins/ethereum/market_chart'),
]);
check('dedupe -> upstream calls', upstreamCalls, 1);
check('dedupe -> all 200', three.every((x) => x.status === 200), true);

// 4) fresh entry expires + upstream is rate-limited -> serve last known good
const freshKey = url2;
store.delete(freshKey); // simulate TTL expiry (stale copy remains)
upstreamStatus = 429;
r = await call(url2, 'coins/ethereum/market_chart');
check('429 -> STALE', r.headers.get('X-CG-Cache'), 'STALE');
check('429 -> still 200 to the browser', r.status, 200);
const body = await r.json();
check('429 -> body is the cached payload', JSON.stringify(body), JSON.stringify({ prices: [[1, 100]] }));

// 5) no cache at all + upstream down -> honest error (no silent empty data)
store.clear();
r = await call(`${BASE}/global`, 'global');
check('no cache + 429 -> 429 surfaced', r.status, 429);

// 6) disallowed endpoint is rejected (must not be an open proxy)
r = await call(`${BASE}/ping`, 'ping');
check('open-proxy blocked', r.status, 403);

// 7) TTL actually varies by range
function ttlOf(res) {
  return /max-age=(\d+)/.exec(res.headers.get('Cache-Control') || '')?.[1];
}
upstreamStatus = 200;
store.clear();
const d1 = await call(`${BASE}/coins/x/market_chart?vs_currency=usd&days=1`, 'coins/x/market_chart');
const d365 = await call(`${BASE}/coins/y/market_chart?vs_currency=usd&days=365`, 'coins/y/market_chart');
check('TTL days=1', ttlOf(d1), '300');
check('TTL days=365', ttlOf(d365), '21600');

// ---------------------------------------------------------------------------
// Client-side fallback: src/utils/coingecko.ts -> cgFetch()
// Separate URL-aware mock so we can fail the proxy independently of upstream.
// ---------------------------------------------------------------------------
let proxyStatus = 200;
let proxyCalls = 0;
let directCalls = 0;

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.startsWith('/api/cg')) {
    proxyCalls++;
    return proxyStatus === 200
      ? new Response(JSON.stringify({ via: 'edge' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      : new Response('nope', { status: proxyStatus });
  }
  directCalls++;
  return new Response(JSON.stringify({ via: 'direct' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const { cgFetch, CG_BASE } = await import('../src/utils/coingecko.ts');

check('CG_BASE is the proxy in production', CG_BASE, '/api/cg');

// proxy healthy -> only the proxy is used
let cr = await cgFetch('/global');
check('proxy ok -> via edge', (await cr.json()).via, 'edge');
check('proxy ok -> proxy calls', proxyCalls, 1);
check('proxy ok -> direct calls', directCalls, 0);

// proxy rate-limited -> fall back to the visitor's own IP
proxyStatus = 429;
cr = await cgFetch('/simple/price?ids=bitcoin');
check('proxy 429 -> via direct', (await cr.json()).via, 'direct');
check('proxy 429 -> direct called', directCalls, 1);

// once the edge proved unusable, stop knocking on it for this page's life
const proxyBefore = proxyCalls;
await cgFetch('/global');
await cgFetch('/search/trending');
check('edge marked down -> proxy not retried', proxyCalls, proxyBefore);

// a real 4xx from the proxy is a real answer: do not silently go direct
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
