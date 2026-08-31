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
 *   3. it has a Cloudflare Pages grant       -> log only (advisory)
 *   4. that grant looks like write, not read -> warn
 *   5. the account ID matches the token scope -> warn
 *
 * Steps 3 and 4 are advisory on purpose. Permission group names are not stable
 * across API versions, so matching on them can only ever be a hint -- and a
 * hard failure here blocks tokens that actually work. The authoritative check
 * is a real call to the Pages API (the next workflow step): a 200 proves
 * access whatever the grant is called, a 403 disproves it.
 *
 * Step 3 writes to the plain log rather than the Annotations panel. A healthy
 * run should produce zero warnings; otherwise the panel is noise and the one
 * warning that does matter gets ignored.
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

/**
 * Informational line: goes to the step log, NOT to the Annotations panel.
 *
 * Used for "cannot tell" outcomes where a later step is authoritative. Putting
 * those in ::warning:: made every healthy run show warnings, which trains
 * people to ignore the panel -- and they then miss the one that matters.
 */
function note(msg) {
  console.log(`(note) ${msg}`);
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

  // --- 3. Pages grant: ADVISORY ONLY, never a hard failure -----------------
  //
  // This used to hard-fail when no permission group name matched /pages/i.
  // That was a false negative: the token in use could demonstrably list Pages
  // projects (the next step proved it with a 200), yet the verify endpoint
  // reported it under a name this regex did not recognise, and the deploy was
  // blocked with "no Cloudflare Pages permission at all".
  //
  // Permission group naming is not stable across API versions, so name
  // matching can only ever be a hint. The authoritative test is a real call to
  // the Pages API, which the next step performs: a 200 there proves access no
  // matter what the grant is called, and a 403 proves the opposite.
  const pagesGroups = groups.filter((g) => /pages/i.test(g));
  if (groups.length === 0) {
    // Deliberately a plain log line, not ::warning::.
    //
    // Account-level API tokens created from the Cloudflare dashboard commonly
    // report an empty permission_groups array on /user/tokens/verify while
    // working perfectly. Emitting a warning here put two permanent,
    // unactionable warnings on every single run -- including successful ones --
    // and the deploy pipeline then looked broken when it was fine.
    //
    // Nothing is lost: the next step calls GET /accounts/{id}/pages/projects
    // and hard-fails on 401/403, which is the real answer.
    note('this token reported no permission groups, so its Pages access cannot be');
    note('judged from this response. That is normal for account-level dashboard');
    note('tokens. The next step settles it by calling the Pages API directly.');
  } else if (pagesGroups.length === 0) {
    note(`none of this token's permission groups mentions Pages (${groups.join(', ')}).`);
    note('Either the token really lacks Pages access, or the grant is named');
    note('differently. The next step settles it by calling the Pages API directly.');
  }

  // --- 4. write vs read --------------------------------------------------
  // Permission group names are not consistently suffixed across API versions:
  // some report "Cloudflare Pages Write", others just "Cloudflare Pages". So a
  // missing Write/Edit marker is a warning, never a hard failure -- a false
  // stop here would block a token that actually works.
  const writeGrants = groups.filter((g) => /(\bwrite\b|\bedit\b)/i.test(g));
  if (pagesGroups.length > 0 && !writeGrants.some((g) => /pages/i.test(g))) {
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
