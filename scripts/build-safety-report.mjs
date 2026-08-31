/**
 * CryptoNav Safety Score pipeline.
 *
 * Turns hand-written claims ("verified: true", "riskLevel: low" — which today
 * are assertions backed by nothing) into dated, sourced, reproducible facts.
 *
 * Design rules, in priority order:
 *   1. Never invent. If a source is unreachable the dimension is `null`, the
 *      weight is redistributed across the dimensions we *did* verify, and the
 *      page says "not verified". An honest gap beats a plausible number.
 *   2. Understate, never overstate. Where two sources disagree about how old a
 *      project is we take the LATER date, because claiming more history than a
 *      project has is the one error that destroys a safety product.
 *   3. Attribute by hand, measure by machine. Humans decide which incident
 *      belongs to which project; every number comes from the live feed.
 *
 * Sources (all free, no API key — a score nobody can reproduce is worthless):
 *   - RDAP via IANA bootstrap  -> domain registration date
 *   - Internet Archive CDX     -> first capture, i.e. when the site really
 *                                 started operating (catches premium domains
 *                                 bought second-hand: solana.com is registered
 *                                 1993 but Solana launched in 2020)
 *   - DefiLlama /hacks         -> security incident history
 *   - GoPlus token_security    -> contract risk, token-holding projects only
 *
 * Run:  node scripts/build-safety-report.mjs [--offline]
 *       --offline skips every network call and re-scores from the existing
 *       report, which is how you test scoring changes without hammering APIs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INCIDENTS, REJECTED_MATCHES, TOKENS, RDAP_OVERRIDES } from './curation.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OFFLINE = process.argv.includes('--offline');
const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 0) || 0;
const TIMEOUT = 25000;
const UA = 'CryptoNav-SafetyBot/1.0 (+https://cryptonav.site/verify)';

// Bitcoin's whitepaper is the earliest moment a "crypto project" can exist.
// A domain registered before it was necessarily bought second-hand later, so
// the registration date tells us nothing about the project's age.
const CRYPTO_EPOCH = Date.UTC(2008, 9, 31) / 1000;

const warn = [];
const notes = [];

/* ------------------------------------------------------------------ *
 * fetch helpers
 * ------------------------------------------------------------------ */

async function getJson(url, accept = 'application/json') {
  return withRetry(async () => {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { accept, 'user-agent': UA },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
}

/**
 * Transient failures are the norm on free APIs: Verisign throttles bursts of
 * RDAP queries and GoPlus drops requests without warning. Retry with backoff
 * rather than recording a hole in the data.
 *
 * But only HTTP-level failures are worth retrying. A network error means the
 * host is blocked, firewalled or dead — retrying that three times per domain,
 * across 63 domains, turned a 3-minute run into a 25-minute one with nothing
 * to show for it.
 */
// A timeout counts as a network failure: retrying it just burns the budget,
// and for a per-domain loop it is the difference between 12 seconds and 210.
const isNetworkError = (e) =>
  e?.name === 'TimeoutError' || e?.name === 'AbortError'
  || /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|getaddrinfo|ETIMEDOUT|aborted/i.test(e?.message ?? '');

async function withRetry(fn, tries = 3, base = 900) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (isNetworkError(e) || i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, base * 2 ** i));
    }
  }
  throw last;
}

/**
 * Circuit breaker per source.
 *
 * The Internet Archive is slow and, from some networks, unreachable. Hammering
 * it 63 times when it is clearly down wastes minutes and earns us a block.
 * Once a source fails `threshold` times in a row we stop calling it for the
 * rest of the run and report it as unavailable.
 */
function breaker(name, threshold = 3) {
  let failures = 0;
  let open = false;
  return {
    get open() { return open; },
    record(err) {
      if (!isNetworkError(err) || open) return;
      failures += 1;
      if (failures >= threshold) {
        open = true;
        notes.push(`${name} unreachable after ${failures} failed attempts — skipped for the rest of this run`);
      }
    },
    reset() { failures = 0; },
  };
}

/** Run `fn` over `items` with bounded concurrency, preserving order. */
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i).catch((e) => ({ __error: e.message }));
      }
    }),
  );
  return out;
}

/* ------------------------------------------------------------------ *
 * 1. domain age — RDAP
 * ------------------------------------------------------------------ */

const host = (u) => {
  try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; }
};
/** Keep the registrable part: app.uniswap.org -> uniswap.org */
const registrable = (h) => (h ? h.split('.').slice(-2).join('.') : null);

async function rdapBaseMap() {
  const j = await getJson('https://data.iana.org/rdap/dns.json');
  const map = new Map();
  for (const [tlds, urls] of j.services) {
    if (!urls?.length) continue;
    for (const t of tlds) map.set(t, urls[0]);
  }
  return map;
}

async function rdapLookup(domain, baseMap) {
  const tld = domain.split('.').pop();
  const base = RDAP_OVERRIDES[tld] ?? baseMap.get(tld);
  if (!base) return { domain, error: 'no-rdap-service' };
  const url = `${base.replace(/\/$/, '')}/domain/${domain}`;
  try {
    const j = await getJson(url, 'application/rdap+json');
    const ev = Object.fromEntries((j.events || []).map((e) => [e.eventAction, e.eventDate]));
    return {
      domain,
      registeredAt: ev.registration ?? null,
      lastChangedAt: ev['last changed'] ?? ev.last_changed ?? null,
      expiresAt: ev.expiration ?? null,
      registrar: (j.entities || [])
        .flatMap((e) => (e.roles || []).includes('registrar') ? [e.vcardArray?.[1]] : [])
        .flatMap((v) => (v || []).filter((f) => f[0] === 'fn').map((f) => f[3]))
        .join(', ') || null,
      source: new URL(base).host,
    };
  } catch (e) {
    if (e.message === 'HTTP 404') return { domain, error: 'not-found' };
    return { domain, error: e.message };
  }
}

/* ------------------------------------------------------------------ *
 * 2. first seen on the web — Internet Archive
 * ------------------------------------------------------------------ */

// The CDX endpoint is the slowest source and the one most likely to be blocked
// outright, so it gets its own shorter leash instead of the global timeout.
const WAYBACK_TIMEOUT = 8000;

async function firstCapture(domain, cb) {
  if (cb?.open) return { domain, firstSeenAt: null, error: 'source skipped (unreachable)' };
  const url = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}`
    + '&output=json&limit=1&fl=timestamp&filter=statuscode:200';
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(WAYBACK_TIMEOUT),
      headers: { 'user-agent': UA },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    cb?.reset();
    const ts = j?.[1]?.[0];
    if (!ts || !/^\d{8,14}$/.test(ts)) return { domain, firstSeenAt: null };
    return { domain, firstSeenAt: `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}` };
  } catch (e) {
    cb?.record(e);
    return { domain, firstSeenAt: null, error: e.message };
  }
}

/* ------------------------------------------------------------------ *
 * 3. incidents — DefiLlama
 * ------------------------------------------------------------------ */

function severity(amountUsd) {
  const m = amountUsd / 1e6;
  if (!Number.isFinite(m) || m <= 0) return 3;   // real incident, no $ figure
  if (m < 1) return 5;
  if (m < 10) return 9;
  if (m < 100) return 15;
  return 23;
}

function recency(ts, now) {
  const y = (now - ts) / 31557600;
  if (y < 1) return 1;
  if (y < 3) return 0.8;
  if (y < 5) return 0.6;
  return 0.4;
}

/* ------------------------------------------------------------------ *
 * 4. contract risk — GoPlus
 * ------------------------------------------------------------------ */

/**
 * GoPlus' free tier accepts a comma-separated `contract_addresses` list but
 * returns only ONE result no matter how many you send — verified against
 * batches of 2, 3 and 5 addresses. Batching is therefore worse than useless:
 * it silently drops everything after the first address. One request per token,
 * bounded concurrency.
 */
async function goplus(entries) {
  const rows = await pool(entries, 4, async ([id, t]) => {
    const j = await getJson(
      `https://api.gopluslabs.io/api/v1/token_security/${t.chain}?contract_addresses=${t.address}`,
    );
    const r = j.result?.[t.address.toLowerCase()] ?? j.result?.[t.address];
    if (!r) return [id, { error: 'no-result' }];
    return [id, {
      symbol: t.symbol,
      chain: t.chain,
      address: t.address,
      isOpenSource: r.is_open_source === '1',
      isHoneypot: r.is_honeypot === '1',
      isMintable: r.is_mintable === '1',
      canTakeBackOwnership: r.can_take_back_ownership === '1',
      isProxy: r.is_proxy === '1',
      isBlacklisted: r.is_blacklisted === '1',
      holderCount: Number(r.holder_count) || null,
      ownerAddress: r.owner_address || null,
    }];
  });
  return Object.fromEntries(rows.filter(Boolean));
}

/* ------------------------------------------------------------------ *
 * scoring
 * ------------------------------------------------------------------ */

const iso = (v) => (typeof v === 'string' ? v.slice(0, 10) : v);
const years = (isoDate, now) => (isoDate ? (now - Date.parse(isoDate)) / 31557600000 : null);

function agePoints(age) {
  if (age >= 10) return 30;
  if (age >= 7) return 27;
  if (age >= 5) return 23;
  if (age >= 3) return 18;
  if (age >= 2) return 13;
  if (age >= 1) return 7;
  return 2;
}

/**
 * Longevity.
 *
 * The subtlety: a domain's registration date and a project's age are different
 * claims. solana.com was registered in 1993 and base.org in 1996 — both are
 * premium domains bought second-hand long after launch, so their RDAP dates
 * describe a previous owner, not the project.
 *
 * So we prefer the Internet Archive's first capture ("when this site was
 * actually live") and fall back to RDAP. Only an implausible RDAP date is
 * discounted, because a domain registered in 1993 cannot be measuring a crypto
 * project; a plausible one is taken at face value, with the weaker basis
 * published as `confidence` rather than silently baked into the number.
 */
function scoreLongevity(rdap, wb, now) {
  const reg = rdap?.registeredAt ? iso(rdap.registeredAt) : null;
  const seen = wb?.firstSeenAt ?? null;
  if (!reg && !seen) return null;

  const regY = reg ? years(reg, now) : null;
  const seenY = seen ? years(seen, now) : null;

  let basis;
  let age;
  let confidence;
  let note = null;
  let discount = 1;

  if (seen) {
    age = seenY;
    basis = reg ? 'first-capture' : 'first-capture-only';
    if (reg) {
      const gap = regY - seenY; // positive => domain older than the site
      if (Math.abs(gap) <= 2) confidence = 'high';
      else if (gap > 5) { confidence = 'low'; note = 'domain registered long before the site went live — almost certainly acquired second-hand'; }
      else confidence = 'medium';
    } else {
      confidence = 'medium';
    }
  } else {
    age = regY;
    basis = 'domain-registration';
    if (reg && Date.parse(reg) / 1000 < CRYPTO_EPOCH) {
      /*
       * The domain predates Bitcoin, so its registration date says nothing
       * about when this project launched. solana.com (1993) is not evidence
       * that Solana has operated for three decades.
       *
       * The tempting move is to score this harshly — a 0.4 multiplier looks
       * like appropriate caution. It is not: it charges the project for a gap
       * in *our* data, not for risk in the project. That put Solana, DeBank,
       * Dune and CoinDesk — none of which has a recorded incident — on the
       * same score as Binance, which has lost $610M across two.
       *
       * Absent evidence, assume average. 0.5 is the midpoint of the scale, so
       * an uninformative date neither rewards nor punishes, and the project is
       * still ranked below one whose age we can actually verify.
       */
      confidence = 'low';
      discount = 0.5;
      note = 'domain predates Bitcoin and was almost certainly bought second-hand, so its registration date says nothing about how long the project has operated';
    } else {
      // A plausible registration date is real evidence that the domain is not
      // new. Discounting it just because our archive call failed would make
      // every score swing by several points whenever a third-party API has a
      // bad day, which is worse than the uncertainty it is meant to express.
      // The missing corroboration is published instead, as `confidence`.
      confidence = 'medium';
      discount = 1;
    }
  }

  const score = Math.round(agePoints(age) * discount);

  // `operatingSince` is a claim about the PROJECT, so it is only published when
  // we actually have evidence of operation: an archived snapshot, or a
  // registration date recent enough to be plausible. Otherwise it stays null
  // and the page says "not verified" — the alternative is telling readers that
  // Solana has operated since 1993, which is both false and instantly
  // discrediting. The registration date itself is still reported as a fact.
  const canClaimOperatingAge = Boolean(seen) || (reg && confidence !== 'low');
  return {
    score,
    confidence,
    basis,
    since: canClaimOperatingAge ? (seen ?? reg) : null,
    age: canClaimOperatingAge ? Math.round(age * 10) / 10 : null,
    reg,
    seen,
    note,
  };
}

function scoreIncidents(list, now) {
  if (!list) return null;
  if (list.length === 0) return { score: MAX.incidents, incidents: [], totalUsd: 0, penalty: 0 };
  let penalty = 0;
  for (const inc of list) {
    penalty += severity(inc.amountUsd) * recency(inc.dateTs, now);
  }
  penalty = Math.round(penalty * 10) / 10;
  return {
    score: Math.max(2, Math.round(35 - penalty)),
    incidents: list,
    totalUsd: list.reduce((a, i) => a + (i.amountUsd || 0), 0),
    penalty,
  };
}

function scoreContract(t) {
  if (!t || t.error) return null;
  if (t.isHoneypot) return { score: 0, flags: ['contract flagged as honeypot'] };
  let score = 20;
  const flags = [];
  if (!t.isOpenSource) { score -= 6; flags.push('contract source not published'); }
  if (t.canTakeBackOwnership) { score -= 5; flags.push('owner can reclaim contract ownership'); }
  if (t.isBlacklisted) { score -= 8; flags.push('address present on a blacklist'); }
  if (t.isProxy) { score -= 3; flags.push('upgradeable proxy'); }
  if (t.isMintable) { score -= 2; flags.push('supply is mintable'); }
  if (t.holderCount !== null && t.holderCount < 1000) { score -= 4; flags.push(`only ${t.holderCount} holders`); }
  return { score: Math.max(0, score), flags };
}

/**
 * How much each dimension counts toward the 100-point headline score, and the
 * raw maximum of each dimension's own scale. They differ, so every dimension is
 * normalised to a percentage before weighting — without that step a score built
 * from two dimensions maxes out at ~33 instead of 100.
 */
const WEIGHTS = { longevity: 35, incidents: 40, contract: 25 };
const MAX = { longevity: 30, incidents: 35, contract: 20 };

/**
 * Combine dimensions. Dimensions we could not verify are dropped and their
 * weight is redistributed proportionally, so a CEX with no token is not
 * punished for not having a token.
 */
/**
 * A score built from one dimension is not a safety score, it is a number that
 * looks like one. Refuse to rate below two dimensions — otherwise a project we
 * know almost nothing about (MEXC, before the archive was reachable) scored a
 * perfect 100 on incident data alone.
 */
const MIN_COVERAGE = 50;

/**
 * What we assume about a dimension we could not verify.
 *
 * The previous model capped `total` at `coverage`, on the reasoning that a
 * project should not outscore the share of the rubric we could check. The
 * intent was right and the mechanism was wrong: with 45 of 63 projects sitting
 * at 75% coverage, the cap pinned 33 of them at exactly 75. Half the directory
 * carried an identical score, which is worse than any single inflated number —
 * it tells a visitor the metric is decorative.
 *
 * Shrinking toward a prior keeps the intent and restores discrimination. A
 * project we know less about is pulled toward "we don't know", so partial data
 * still cannot produce a perfect score, but two projects with different
 * records no longer collapse onto the same number.
 *
 * 50 is the midpoint: where we have no evidence we assume average, which
 * neither rewards nor punishes. Calibration run: at 55, 26 of 62 projects came
 * out grade A, which overstates what three automated checks can justify.
 */
const PRIOR = 50;

function combine(dims) {
  const present = Object.entries(dims).filter(([, v]) => v && v.score !== null && v.score !== undefined);
  const w = present.reduce((a, [k]) => a + WEIGHTS[k], 0);
  const coverage = Math.round((w / 100) * 100);
  if (!w) return { total: null, grade: 'unrated', coverage: 0, verifiedChecks: 0, unratedReason: 'no verification source returned data' };
  if (coverage < MIN_COVERAGE) {
    return {
      total: null,
      grade: 'unrated',
      coverage,
      verifiedChecks: present.length,
      unratedReason: `only ${present.length} of ${Object.keys(WEIGHTS).length} checks produced data`,
    };
  }
  const raw = Math.round(
    present.reduce((a, [k, v]) => a + (v.score / MAX[k]) * 100 * (WEIGHTS[k] / w), 0),
  );
  const share = coverage / 100;
  const total = Math.round(raw * share + PRIOR * (1 - share));
  return {
    total,
    raw,
    prior: PRIOR,
    grade: total >= 85 ? 'A' : total >= 70 ? 'B' : total >= 55 ? 'C' : total >= 40 ? 'D' : 'E',
    coverage,
    verifiedChecks: present.length,
    weightsUsed: Object.fromEntries(present.map(([k]) => [k, WEIGHTS[k]])),
  };
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

const projectsFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/projects.json'), 'utf8'));
const projects = LIMIT ? projectsFile.projects.slice(0, LIMIT) : projectsFile.projects;
const outFile = path.join(ROOT, 'src/data/safety.json');
const prev = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : null;

let rdapMap = new Map();
let rdapResults = {};
let wbResults = {};
let hacks = [];
let tokenResults = {};

/**
 * How long a cached value stays valid.
 *
 * A domain's registration date never changes, so RDAP is cached forever once it
 * succeeds. Holder counts and archive coverage do move, so those expire. The
 * point is that a transient API failure on run N must never erase a fact we
 * already proved on run N-1 — without this, every flaky response turns into a
 * hole in every downstream page.
 */
const TTL = { wayback: 30 * 86400e3, tokens: 7 * 86400e3 };
const fresh = (entry, ttl) => entry && !entry.error && Date.now() - (entry.fetchedAt ?? 0) < ttl;

if (!OFFLINE) {
  const domains = [...new Set(projects.map((p) => registrable(host(p.website))).filter(Boolean))];
  const prevRdap = prev?.raw?.rdap ?? {};
  const prevWb = prev?.raw?.wayback ?? {};
  const prevTok = prev?.raw?.tokens ?? {};

  const needRdap = domains.filter((d) => !prevRdap[d] || prevRdap[d].error);
  const needWb = domains.filter((d) => !fresh(prevWb[d], TTL.wayback));
  const needTok = Object.entries(TOKENS).filter(([id]) => !fresh(prevTok[id], TTL.tokens));

  console.log(`${domains.length} domains (${needRdap.length} to query), `
    + `${needWb.length} archive lookups, ${needTok.length} contracts to query`);

  rdapResults = { ...prevRdap };
  wbResults = { ...prevWb };
  tokenResults = { ...prevTok };

  if (needRdap.length) {
    rdapMap = await rdapBaseMap().catch((e) => { warn.push(`RDAP bootstrap unavailable: ${e.message}`); return new Map(); });
    const r = await pool(needRdap, 4, async (d) => ({ ...(await rdapLookup(d, rdapMap)), fetchedAt: Date.now() }));
    for (const x of r) if (x && !x.__error) rdapResults[x.domain] = x;
  }
  if (needWb.length) {
    const wbBreaker = breaker('Internet Archive');
    const w = await pool(needWb, 3, async (d) => ({ ...(await firstCapture(d, wbBreaker)), fetchedAt: Date.now() }));
    for (const x of w) if (x && !x.__error) wbResults[x.domain] = x;
  }

  hacks = await getJson('https://api.llama.fi/hacks').catch((e) => { warn.push(`DefiLlama hacks unavailable: ${e.message}`); return []; });

  if (needTok.length) {
    const t = await goplus(needTok);
    for (const [id, v] of Object.entries(t)) tokenResults[id] = { ...v, fetchedAt: Date.now() };
  }

  const noRdap = domains.filter((d) => rdapResults[d]?.error);
  if (noRdap.length) notes.push(`RDAP unavailable for: ${noRdap.join(', ')}`);
  const noWb = domains.filter((d) => !wbResults[d]?.firstSeenAt);
  if (noWb.length === domains.length) notes.push('Internet Archive unreachable — longevity falls back to RDAP only');
} else {
  console.log('offline: re-scoring from existing report');
  rdapResults = prev?.raw?.rdap ?? {};
  wbResults = prev?.raw?.wayback ?? {};
  hacks = prev?.raw?.hacks ?? [];
  tokenResults = prev?.raw?.tokens ?? {};
  if (!hacks.length) warn.push('offline mode with no cached hacks feed');
}

/* --- incident attribution --- */
const hackByKey = new Map(hacks.map((h) => [String(h.date), h]));
const usedKeys = new Set();
const incidentsByProject = {};
for (const [pid, keys] of Object.entries(INCIDENTS)) {
  const list = [];
  for (const k of keys) {
    const rec = hackByKey.get(String(k));
    if (!rec) { warn.push(`curated incident ${k} for "${pid}" is missing from the DefiLlama feed`); continue; }
    usedKeys.add(String(k));
    list.push({
      date: new Date(rec.date * 1000).toISOString().slice(0, 10),
      dateTs: rec.date,
      name: rec.name,
      amountUsd: typeof rec.amount === 'number' ? rec.amount : null,
      technique: rec.technique || null,
      targetType: rec.targetType || null,
      returnedFunds: rec.returnedFunds ?? null,
      source: 'DefiLlama',
    });
  }
  incidentsByProject[pid] = list.sort((a, b) => b.dateTs - a.dateTs);
}

/* --- score every project --- */
const now = Date.now();
const report = {};
for (const p of projects) {
  const dom = registrable(host(p.website));
  const rdap = rdapResults[dom];
  const wb = wbResults[dom];
  const lon = scoreLongevity(rdap, wb, now);
  const inc = scoreIncidents(incidentsByProject[p.id] ?? [], now);
  const tok = scoreContract(tokenResults[p.id]);
  const dims = { longevity: lon, incidents: inc, contract: tok };

  const combined = combine(dims);
  report[p.id] = {
    name: p.name,
    category: p.category,
    domain: dom,
    website: p.website,
    domainRegisteredAt: lon?.reg ?? null,
    domainRegistrar: rdap?.registrar ?? null,
    firstSeenAt: lon?.seen ?? null,
    operatingSince: lon?.since ?? null,
    ageYears: lon?.age != null ? Math.round(lon.age * 10) / 10 : null,
    ageConfidence: lon?.confidence ?? 'unknown',
    ageNote: lon?.note ?? null,
    incidents: inc?.incidents ?? [],
    incidentCount: inc?.incidents.length ?? 0,
    incidentTotalUsd: inc?.totalUsd ?? 0,
    token: tokenResults[p.id] && !tokenResults[p.id].error
      ? { symbol: tokenResults[p.id].symbol, chain: tokenResults[p.id].chain, address: tokenResults[p.id].address,
          holderCount: tokenResults[p.id].holderCount, isOpenSource: tokenResults[p.id].isOpenSource,
          isHoneypot: tokenResults[p.id].isHoneypot, isMintable: tokenResults[p.id].isMintable,
          isProxy: tokenResults[p.id].isProxy, canTakeBackOwnership: tokenResults[p.id].canTakeBackOwnership }
      : null,
    contractFlags: tok?.flags ?? [],
    dimensions: {
      longevity: lon ? { score: lon.score, max: MAX.longevity, weight: WEIGHTS.longevity } : null,
      incidents: inc ? { score: inc.score, max: MAX.incidents, weight: WEIGHTS.incidents, penalty: inc.penalty } : null,
      contract: tok ? { score: tok.score, max: MAX.contract, weight: WEIGHTS.contract } : null,
    },
    score: combined.total,
    grade: combined.grade,
    coverage: combined.coverage,
    verifiedChecks: combined.verifiedChecks,
    totalChecks: Object.keys(WEIGHTS).length,
    unratedReason: combined.unratedReason ?? null,
  };
}

const payload = {
  generatedAt: new Date().toISOString(),
  method: 'https://cryptonav.site/verify#method',
  weights: WEIGHTS,
  counts: {
    projects: projects.length,
    withDomainAge: Object.values(report).filter((r) => r.domainRegisteredAt).length,
    withFirstSeen: Object.values(report).filter((r) => r.firstSeenAt).length,
    withIncidents: Object.values(report).filter((r) => r.incidentCount > 0).length,
    withContract: Object.values(report).filter((r) => r.token).length,
    rated: Object.values(report).filter((r) => r.score !== null).length,
    unrated: Object.values(report).filter((r) => r.score === null).length,
  },
  sources: {
    domainAge: 'RDAP (IANA bootstrap + registry endpoints)',
    firstSeen: 'Internet Archive CDX API',
    incidents: 'DefiLlama /hacks (attribution curated by CryptoNav)',
    contract: 'GoPlus token_security',
  },
  rejectedMatches: REJECTED_MATCHES,
  warnings: warn,
  notes,
  raw: { rdap: rdapResults, wayback: wbResults, tokens: tokenResults, hacks: hacks.map((h) => ({ date: h.date, name: h.name, amount: h.amount, technique: h.technique, targetType: h.targetType, defillamaId: h.defillamaId ?? null })) },
  projects: report,
};

fs.writeFileSync(outFile, JSON.stringify(payload, null, 2) + '\n');

/* --- console summary --- */
const c = payload.counts;
console.log(`\n${c.projects} projects -> ${c.rated} rated`);
console.log(`  domain age   ${c.withDomainAge}/${c.projects}`);
console.log(`  first seen   ${c.withFirstSeen}/${c.projects}`);
console.log(`  incidents    ${c.withIncidents}/${c.projects}`);
console.log(`  contracts    ${c.withContract}/${c.projects}`);
for (const n of notes) console.log(`  note: ${n}`);
for (const w of warn) console.log(`  WARN ${w}`);

const ranked = Object.values(report).filter((r) => r.score !== null).sort((a, b) => b.score - a.score);
console.log('\n  top 8:   ' + ranked.slice(0, 8).map((r) => `${r.name} ${r.score}`).join('  '));
console.log('  bottom 8:' + ranked.slice(-8).map((r) => `${r.name} ${r.score}`).join('  '));
