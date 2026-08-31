#!/usr/bin/env node
/**
 * Regression tests for scripts/verify-cloudflare-token.mjs.
 *
 * Each case spawns the verifier in a child process with globalThis.fetch
 * replaced by a fixture, then asserts on the exit code and on how many
 * ::error:: / ::warning:: / (note) lines it emitted.
 *
 * WHY ASSERT ON WARNING COUNTS AND NOT JUST THE EXIT CODE
 * -------------------------------------------------------
 * The bug this suite exists to prevent was not a wrong exit code. It was a
 * *correct* exit code paired with two permanent warnings: the verifier hard-
 * failed and later warned because /user/tokens/verify reported no permission
 * groups for a token that demonstrably worked. Every healthy run therefore
 * looked broken, and the deploy pipeline was chased as the cause for a day.
 *
 * So the contract is: a token that will deploy must produce ZERO warnings.
 * If a future edit starts warning on a healthy token, this suite fails.
 *
 * No network access, no real token, no dependencies.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { SCENARIOS } from './mock-cloudflare-verify.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

// Two different rules, and getting either wrong costs a debugging session:
//
//   --import  needs a module SPECIFIER. A raw Windows absolute path such as
//             C:\repo\...\mock.mjs is parsed as a URL whose scheme is "c:", so
//             Node dies with ERR_UNSUPPORTED_ESM_URL_SCHEME. Use a file:// URL.
//
//   the entry script needs a real FILESYSTEM PATH. Hand it a file:// URL and
//             Node 22 treats it as a relative path, producing the baffling
//             "Cannot find module 'C:\repo\file:\C:\repo\scripts\...'".
const verifier = path.join(here, 'verify-cloudflare-token.mjs');
const mock = pathToFileURL(path.join(here, 'mock-cloudflare-verify.mjs')).href;

const ACCOUNT = 'acct_1111111111111111111111111111';

/**
 * expectations:
 *   exit     0 = clear to deploy, 1 = blocked
 *   errors   minimum number of ::error:: lines
 *   warnings EXACT number of ::warning:: lines (0 means "must stay quiet")
 */
const cases = {
  'ok-pages-write': { exit: 0, errors: 0, warnings: 0 },
  // ★ The regression case. This is the shape of the token that actually
  // deploys this site: verify reports no permission groups, Pages API accepts
  // it. It must pass silently.
  'ok-no-groups': { exit: 0, errors: 0, warnings: 0 },
  'ok-pages-renamed': { exit: 0, errors: 0, warnings: 0 },

  // Real problems: these SHOULD be loud.
  'pages-readonly': { exit: 0, errors: 0, warnings: 4 },
  'wrong-account': { exit: 0, errors: 0, warnings: 3 },
  'expiring-soon': { exit: 0, errors: 0, warnings: 1 },

  // Hard failures.
  'already-expired': { exit: 1, errors: 1 },
  'token-rejected': { exit: 1, errors: 1 },
  'token-disabled': { exit: 1, errors: 1 },
  'unparseable': { exit: 1, errors: 1 },
  'network-throw': { exit: 1, errors: 1 },
  'no-pages-grant': { exit: 0, errors: 0, warnings: 0 },
};

function run(scenario) {
  const res = spawnSync(process.execPath, ['--import', mock, verifier], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      MOCK_SCENARIO: scenario,
      CLOUDFLARE_API_TOKEN: 'test-token-not-real',
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
    },
  });

  if (res.error) throw res.error;
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  return {
    exit: res.status,
    errors: (out.match(/^::error::/gm) || []).length,
    warnings: (out.match(/^::warning::/gm) || []).length,
    notes: (out.match(/^\(note\)/gm) || []).length,
    out,
  };
}

let pass = 0;
let fail = 0;
const failures = [];

function check(label, actual, expected) {
  if (actual === expected) return true;
  failures.push(`${label}: expected ${expected}, got ${actual}`);
  return false;
}

console.log('verify-cloudflare-token regression suite\n');

// Completeness: every fixture must have a case, and vice versa.
const missingCase = SCENARIOS.filter((s) => !(s in cases));
const orphanCase = Object.keys(cases).filter((s) => !SCENARIOS.includes(s));

if (missingCase.length) {
  fail++;
  failures.push(`fixtures with no test case: ${missingCase.join(', ')}`);
}
if (orphanCase.length) {
  fail++;
  failures.push(`test cases with no fixture: ${orphanCase.join(', ')}`);
}

for (const [scenario, exp] of Object.entries(cases)) {
  let r;
  try {
    r = run(scenario);
  } catch (err) {
    fail++;
    failures.push(`${scenario}: threw -- ${err && err.message ? err.message : err}`);
    console.log(`  FAIL  ${scenario} (threw)`);
    continue;
  }

  const ok =
    check(`${scenario} exit`, r.exit, exp.exit) &&
    check(`${scenario} errors>=`, r.errors >= exp.errors, true) &&
    (exp.warnings === undefined || check(`${scenario} warnings`, r.warnings, exp.warnings));

  if (ok) {
    pass++;
    console.log(
      `  PASS  ${scenario.padEnd(18)} exit=${r.exit} err=${r.errors} warn=${r.warnings} note=${r.notes}`
    );
  } else {
    fail++;
    console.log(
      `  FAIL  ${scenario.padEnd(18)} exit=${r.exit} err=${r.errors} warn=${r.warnings} note=${r.notes}`
    );
  }
}

// The headline guarantee, spelled out so its failure is self-explanatory.
const healthy = ['ok-pages-write', 'ok-no-groups', 'ok-pages-renamed'];
for (const s of healthy) {
  const r = run(s);
  if (r.warnings !== 0) {
    fail++;
    failures.push(
      `HEALTHY TOKEN WARNS: "${s}" produced ${r.warnings} warning(s). A token ` +
        `that can deploy must produce none -- noisy warnings are what made ` +
        `every successful run look broken.`
    );
  }
}

console.log(`\n${pass} passed, ${fail} failed`);

if (fail) {
  console.error('\nFAILURES:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log('\nall token-check branches behave as documented');
