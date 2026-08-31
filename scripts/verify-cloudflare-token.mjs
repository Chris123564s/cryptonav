#!/usr/bin/env node
/**
 * Pre-flight check for the Cloudflare API token used by `wrangler pages deploy`.
 *
 * Why this exists: when the token is wrong, `wrangler pages deploy` fails with
 * a short, generic message. Wrapped in a 3-attempt retry loop that looks
 * identical to a transient network failure, so the real cause (a read-only
 * token, or one scoped to a different account) stays invisible and the team
 * burns a whole CI run per guess.
 *
 * Checks, in order:
 *   1. the token is accepted at all          -> hard fail
 *   2. it is active and not expired          -> hard fail / warn near expiry
 *   3. it has *some* Cloudflare Pages grant  -> hard fail
 *   4. that grant looks like write, not read -> warn   (naming varies by API
 *                                             version, so never hard fail here)
 *   5. the account ID matches the token scope -> warn
 *
 * Exit 0 = go ahead and deploy. Exit 1 = do not bother, it cannot work.
 *
 * Only uses global fetch, so Node 18+. No dependencies.
 */

const TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '';

const VERIFY_URL = 'https://api.cloudflare.com/client/v4/user/tokens/verify';

function warn(msg) {
  console.log(`::warning::${msg}`);
}

function fail(...msgs) {
  for (const m of msgs) console.log(`::error::${m}`);
  process.exit(1);
}

/** Collect every string key and value in a nested structure. */
function collectStrings(node, out = []) {
  if (node == null) return out;
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectStrings(item, out);
    return out;
  }
  if (typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      out.push(key);
      collectStrings(value, out);
    }
  }
  return out;
}

async function main() {
  if (!TOKEN) fail('CLOUDFLARE_API_TOKEN is empty -- nothing to verify');

  let res;
  let body;
  try {
    res = await fetch(VERIFY_URL, { headers: { Authorization: `Bearer ${TOKEN}` } });
    body = await res.text();
  } catch (err) {
    fail(`could not reach api.cloudflare.com: ${err && err.message ? err.message : err}`);
  }

  console.log(`token verify HTTP ${res.status}`);

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    fail(
      'could not parse the token verification response',
      `raw response (first 300 chars): ${String(body).slice(0, 300).replace(/\n/g, ' ')}`
    );
  }

  if (!payload.success) {
    const msgs = (payload.errors || [])
      .map((e) => e.message || JSON.stringify(e))
      .join('; ');
    fail(
      `Cloudflare rejected the token: ${msgs || '(no error detail returned)'}`,
      'check CLOUDFLARE_API_TOKEN -- it is wrong, expired, or revoked.'
    );
  }

  const result = payload.result || {};
  console.log(`token status : ${result.status}`);
  console.log(`token expires: ${result.expires_on || '(never)'}`);

  const policies = Array.isArray(result.policies) ? result.policies : [];
  const groups = [
    ...new Set(
      policies.flatMap((p) =>
        (p.permission_groups || []).map((g) => g.name || g.id).filter(Boolean)
      )
    ),
  ];
  console.log(`permissions  : ${groups.length ? groups.join(', ') : '(none reported)'}`);

  // --- 2. active / not expired -------------------------------------------
  if (result.expires_on) {
    const expiresAt = Date.parse(result.expires_on);
    if (!Number.isNaN(expiresAt)) {
      const days = Math.floor((expiresAt - Date.now()) / 86_400_000);
      if (days < 0) {
        fail(`token expired ${-days} day(s) ago -- re-create it and update the secret`);
      }
      if (days <= 14) {
        warn(`token expires in ${days} day(s) -- rotate it before it breaks a deploy`);
      }
    }
  }

  if (result.status !== 'active') {
    fail(`token status is "${result.status}", not active -- re-create it and update the secret`);
  }

  // --- 3. has any Pages grant --------------------------------------------
  const pagesGroups = groups.filter((g) => /pages/i.test(g));
  if (pagesGroups.length === 0) {
    fail(
      'the token has no Cloudflare Pages permission at all -- it can never deploy',
      're-create it with the "Edit Cloudflare Pages" template (or a custom token',
      'granting Pages: Edit) and update the CLOUDFLARE_API_TOKEN secret.'
    );
  }

  // --- 4. write vs read --------------------------------------------------
  // Permission group names are not consistently suffixed across API versions:
  // some report "Cloudflare Pages Write", others just "Cloudflare Pages". So a
  // missing Write/Edit marker is a warning, never a hard failure -- a false
  // stop here would block a token that actually works.
  const writeGrants = groups.filter((g) => /(\bwrite\b|\bedit\b)/i.test(g));
  if (!writeGrants.some((g) => /pages/i.test(g))) {
    warn(`Pages grants found: ${pagesGroups.join(', ')} -- none of them says Write or Edit.`);
    warn('a read-only Pages token can list projects but NOT deploy, and fails');
    warn('identically on every retry. If the deploy fails below, re-create the');
    warn('token with "Edit Cloudflare Pages" and update CLOUDFLARE_API_TOKEN.');
  }

  // --- 5. account scope --------------------------------------------------
  if (ACCOUNT_ID) {
    const keys = collectStrings(policies.map((p) => p.resources || {}));
    const accountKeys = keys.filter((k) => k.includes('com.cloudflare.api.account.'));
    const scopedIds = [
      ...new Set(accountKeys.map((k) => k.split('.').pop()).filter((id) => id && id !== '*')),
    ];

    if (scopedIds.length === 0) {
      console.log('account scope: unrestricted (token is not limited to named accounts)');
    } else if (scopedIds.includes(ACCOUNT_ID)) {
      console.log(`account scope: includes ${ACCOUNT_ID}`);
    } else {
      warn(`the token is scoped to account(s) ${scopedIds.join(', ')},`);
      warn(`but CLOUDFLARE_ACCOUNT_ID is ${ACCOUNT_ID}. A token scoped to a`);
      warn('different account fails every deploy. Check both values.');
    }
  }

  console.log('token check passed -- clear to deploy');
}

main().catch((err) => {
  fail(`unexpected failure in token check: ${err && err.stack ? err.stack : err}`);
});
