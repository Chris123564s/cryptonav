#!/usr/bin/env node
/**
 * Validate _routes.json exactly the way Wrangler does.
 *
 * Why this exists: an invalid _routes.json broke every deployment for a full
 * day. Cloudflare Pages' own builder reports it as "Failed to publish assets"
 * -- after a green build, with no mention of routes -- so nothing local
 * warned us. Only `wrangler pages deploy` names it, and by then a CI run has
 * already been spent.
 *
 * The rules below are transcribed from Wrangler 4.127.1, not from the docs.
 * That distinction is the whole point: the docs say `exclude` is optional, but
 * the implementation requires it --
 *
 *   isRoutesJSONSpec(data) =>
 *     ... && Array.isArray(data.include) && Array.isArray(data.exclude)
 *
 * A missing `exclude` key fails that check and the deploy is refused with
 * "Invalid _routes.json ... Please make sure the JSON object has the following
 * format". Validating against the documentation instead of the code is what let
 * this ship in the first place.
 *
 * Usage: node scripts/check-routes-json.mjs [file ...]
 * Defaults to public/_routes.json and dist/_routes.json (when built).
 */

import { readFileSync, existsSync } from 'node:fs';

// Wrangler 4.127.1 constants (wrangler-dist/cli.js)
const ROUTES_SPEC_VERSION = 1;
const MAX_RULES = 100;
const MAX_RULE_LENGTH = 100;

/** Mirrors Wrangler's isRoutesJSONSpec(). `exclude` is mandatory in practice. */
function isRoutesJSONSpec(data) {
  return Boolean(
    typeof data === 'object' &&
      data !== null &&
      !Array.isArray(data) &&
      'version' in data &&
      typeof data.version === 'number' &&
      data.version === ROUTES_SPEC_VERSION &&
      Array.isArray(data.include) &&
      Array.isArray(data.exclude)
  );
}

/** Mirrors Wrangler's hasOverlappingRules(). Checked per-list, not across. */
function hasOverlappingRules(routes) {
  const endingSplatRoutes = routes.filter((route) => route.endsWith('/*'));
  for (const crrRoute of endingSplatRoutes) {
    // "/api/*" -> "/api/"
    const crrRouteTrimmed = crrRoute.substring(0, crrRoute.length - 1);
    for (const nextRoute of routes) {
      if (nextRoute !== crrRoute && nextRoute.startsWith(crrRouteTrimmed)) {
        return { crrRoute, nextRoute };
      }
    }
  }
  return null;
}

function validate(file, raw) {
  const problems = [];
  const fail = (msg) => problems.push(msg);

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.log(`FAIL ${file}: not valid JSON -- ${err.message}`);
    return 1;
  }

  if (!isRoutesJSONSpec(data)) {
    fail(
      'does not match the required shape. Need { version: 1, include: string[], exclude: string[] }.' +
        (data && !Array.isArray(data.exclude)
          ? ' In particular `exclude` is REQUIRED by Wrangler even though the docs call it optional -- add "exclude": [].'
          : '')
    );
    // Nothing below is meaningful if the shape is wrong.
    console.log(`FAIL ${file}`);
    problems.forEach((p) => console.log(`     - ${p}`));
    return 1;
  }

  if (data.include.length === 0) {
    fail('must have at least 1 include rule, but no include rules were detected.');
  }
  if (data.include.length + data.exclude.length > MAX_RULES) {
    fail(
      `has ${data.include.length + data.exclude.length} rules, over the ${MAX_RULES} ` +
        'include+exclude combined limit.'
    );
  }
  for (const rule of [...data.include, ...data.exclude]) {
    if (rule.length > MAX_RULE_LENGTH) {
      fail(`rule "${rule}" is ${rule.length} chars, over the ${MAX_RULE_LENGTH} limit.`);
    }
    if (!rule.startsWith('/')) {
      fail(`rule "${rule}" must start with '/'.`);
    }
  }
  for (const [list, routes] of [
    ['include', data.include],
    ['exclude', data.exclude],
  ]) {
    const overlap = hasOverlappingRules(routes);
    if (overlap) {
      fail(
        `${list} has overlapping rules: "${overlap.crrRoute}" (ending in a splat) ` +
          `overlaps "${overlap.nextRoute}". Checked per list, not across lists.`
      );
    }
  }

  if (problems.length) {
    console.log(`FAIL ${file}`);
    problems.forEach((p) => console.log(`     - ${p}`));
    return 1;
  }

  console.log(
    `OK   ${file} -- version ${data.version}, ` +
      `${data.include.length} include / ${data.exclude.length} exclude rule(s)`
  );
  return 0;
}

const files =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : ['public/_routes.json', 'dist/_routes.json'].filter((f) => existsSync(f));

if (files.length === 0) {
  console.log('no _routes.json found to check (looked for public/ and dist/)');
  process.exit(0);
}

let exit = 0;
for (const file of files) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    console.log(`FAIL ${file}: could not read -- ${err.message}`);
    exit = 1;
    continue;
  }
  if (validate(file, raw) !== 0) exit = 1;
}

process.exit(exit);
