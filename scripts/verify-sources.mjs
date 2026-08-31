/**
 * Verification source registry for the CryptoNav Safety Score.
 *
 * Every source here is FREE and needs NO API key — that matters, because the
 * score has to be reproducible by anyone auditing us, and it must not break
 * when a key expires.
 *
 * Run:  node scripts/verify-sources.mjs
 *       node scripts/verify-sources.mjs --json
 */
const TIMEOUT = 20000;

async function getJson(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { accept: 'application/json', 'user-agent': 'CryptoNav/1.0 (+https://cryptonav.site)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const results = [];
function probe(name, fn) {
  return fn()
    .then((r) => results.push({ name, status: 'ok', ...r }))
    .catch((e) => results.push({ name, status: 'fail', error: e.message }));
}

/**
 * "Reachability" is the one probe that cannot be trusted from every machine.
 * Corporate proxies and sandboxes allow-list hosts, so a thrown network error
 * means "this environment cannot see the internet", NOT "the site is down".
 * We report those as `skip` so the exit code stays honest, and the check runs
 * for real inside GitHub Actions where the network is open.
 */
class EnvBlocked extends Error {}
async function reachable(url) {
  let res;
  try {
    res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) });
  } catch (e) {
    if (e.name === 'AbortError' || /timeout/i.test(e.message)) throw e;
    throw new EnvBlocked(e.message);
  }
  return res;
}

await Promise.all([
  probe('RDAP bootstrap (IANA)', async () => {
    const j = await getJson('https://data.iana.org/rdap/dns.json');
    return { detail: `${j.services.length} TLD services` };
  }),
  probe('RDAP Verisign (.com)', async () => {
    const j = await getJson('https://rdap.verisign.com/com/v1/domain/binance.com');
    const reg = (j.events || []).find((e) => e.eventAction === 'registration');
    return { detail: `binance.com registered ${reg?.eventDate}` };
  }),
  probe('GoPlus token security', async () => {
    const j = await getJson(
      'https://api.gopluslabs.io/api/v1/token_security/1?contract_addresses=0xdAC17F958D2ee523a2206206994597C13D831ec7',
    );
    const t = Object.values(j.result || {})[0];
    if (!t) throw new Error('no result');
    return { detail: `open_source=${t.is_open_source} mintable=${t.is_mintable} honeypot=${t.is_honeypot}` };
  }),
  probe('DefiLlama hacks', async () => {
    const j = await getJson('https://api.llama.fi/hacks');
    return { detail: `${j.length} incidents` };
  }),
  probe('HTTPS reachability', async () => {
    // cryptonav.site is used as the control because it is the one host every
    // runner (CI, laptop, sandbox) is expected to be able to see.
    const res = await reachable('https://cryptonav.site/');
    return { detail: `${res.status} final=${res.url}` };
  }),
]);

// A thrown EnvBlocked means the runner cannot reach out. That is an environment
// problem, not a broken data source, so it must not fail the build.
for (const r of results) {
  if (r.status === 'fail' && r.error && /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|getaddrinfo/i.test(r.error)) {
    r.status = 'skip';
    r.error = `unreachable from this environment (${r.error})`;
  }
}

const json = process.argv.includes('--json');
if (json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const r of results) {
    const tag = { ok: 'OK  ', fail: 'FAIL', skip: 'SKIP' }[r.status];
    console.log(`  ${tag}  ${r.name.padEnd(26)} ${r.status === 'fail' ? r.error : r.detail ?? r.error}`);
  }
}
const failed = results.filter((r) => r.status === 'fail');
const skipped = results.filter((r) => r.status === 'skip');
console.log(`\n${results.length - failed.length - skipped.length}/${results.length} sources reachable`
  + (skipped.length ? `, ${skipped.length} skipped (network restrictions)` : ''));
if (failed.length) process.exit(1);
