/**
 * Assertions for the safety report.
 *
 * The whole value of this feature rests on the reader believing the numbers,
 * and that belief collapses the moment one figure is invented. These checks
 * guard the specific ways this pipeline could lie:
 *
 *   - claiming an operating age for a project whose domain was bought
 *     second-hand (solana.com is registered 1993; Solana launched in 2020)
 *   - attributing an incident to the wrong project
 *   - publishing a score built from a single dimension
 *   - silently dropping a source and scoring as if it had answered "clean"
 *
 * Run:  node scripts/check-safety.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INCIDENTS, TOKENS } from './curation.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const report = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/safety.json'), 'utf8'));
const projects = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/projects.json'), 'utf8')).projects;

// Only ACTIVE projects are required to have a safety record, because only they
// get a /verify page -- see getStaticPaths in src/pages/verify/[slug].astro.
// POST /api/submit appends 'pending' entries that legitimately have no record
// until the report is refreshed, and those must not fail this check. Anything
// asserted below about "every project" therefore means "every active project".
const activeProjects = projects.filter((p) => p.status === 'active');

let pass = 0;
const fails = [];
function ok(cond, label) {
  if (cond) pass += 1;
  else fails.push(label);
}

const P = report.projects;
const all = Object.entries(P);

/* --- coverage against the directory --- */
for (const p of activeProjects) {
  ok(P[p.id], `every active directory project has a safety record: ${p.id}`);
  if (P[p.id]) {
    ok(P[p.id].name === p.name, `name matches directory: ${p.id}`);
    ok(P[p.id].domain === new URL(p.website).hostname.replace(/^www\./, '').split('.').slice(-2).join('.'),
      `domain derived from the listed website: ${p.id}`);
  }
}

/* --- no fabricated dates --- */
for (const [id, s] of all) {
  if (s.domainRegisteredAt) {
    ok(/^\d{4}-\d{2}-\d{2}$/.test(s.domainRegisteredAt), `registration date is ISO: ${id}`);
    ok(s.domainRegisteredAt <= report.generatedAt.slice(0, 10), `registration date is not in the future: ${id}`);
  }
  if (s.firstSeenAt) ok(/^\d{4}-\d{2}-\d{2}$/.test(s.firstSeenAt), `first-seen date is ISO: ${id}`);

  // The critical one: an operating age may only be published when the domain
  // date is plausible for a crypto project. solana.com (1993) must never
  // produce "operating since 1993".
  if (s.operatingSince) {
    ok(s.operatingSince >= '2008-10-31', `operating date is not pre-Bitcoin: ${id} (${s.operatingSince})`);
    ok(s.ageYears !== null && s.ageYears > 0, `age is present and positive when operating date is: ${id}`);
    ok(s.ageYears < 40, `age is plausible: ${id} (${s.ageYears})`);
  } else {
    // No operating date => no age, and the reader must be told why if the
    // reason is a suspicious domain.
    ok(s.ageYears === null, `no age without an operating date: ${id}`);
  }
  if (s.ageConfidence === 'low') {
    ok(s.ageNote, `low-confidence age carries an explanation: ${id}`);
    ok(s.operatingSince === null, `low-confidence age publishes no operating date: ${id}`);
  }
}

/* --- incidents are attributed, not matched --- */
const curatedCount = Object.values(INCIDENTS).reduce((a, v) => a + v.length, 0);
ok(report.counts.withIncidents === Object.keys(INCIDENTS).length,
  `incident-bearing projects match the curation (${report.counts.withIncidents} vs ${Object.keys(INCIDENTS).length})`);

for (const [id, s] of all) {
  const expected = (INCIDENTS[id] ?? []).length;
  ok(s.incidentCount === expected, `incident count matches curation: ${id} (${s.incidentCount} vs ${expected})`);
  const sum = s.incidents.reduce((a, i) => a + (i.amountUsd ?? 0), 0);
  ok(sum === s.incidentTotalUsd, `incident total equals the sum of parts: ${id}`);
  for (const i of s.incidents) {
    ok(i.source === 'DefiLlama', `incident cites its source: ${id}`);
    ok(/^\d{4}-\d{2}-\d{2}$/.test(i.date), `incident date is ISO: ${id}`);
    ok(typeof i.name === 'string' && i.name.length > 0, `incident is named: ${id}`);
  }
}

/* --- scoring integrity --- */
for (const [id, s] of all) {
  const dims = Object.entries(s.dimensions).filter(([, d]) => d);
  const w = dims.reduce((a, [, d]) => a + d.weight, 0);
  ok(s.coverage === w, `coverage equals the sum of verified weights: ${id} (${s.coverage} vs ${w})`);
  ok(s.verifiedChecks === dims.length, `verifiedChecks equals dimension count: ${id}`);

  if (s.score !== null) {
    ok(s.score >= 0 && s.score <= 100, `score is in range: ${id} (${s.score})`);
    // The rule that stops a one-dimension number masquerading as a rating.
    ok(s.dimensions && (s.dimensions.longevity || s.dimensions.incidents)
      && (s.dimensions.incidents || s.dimensions.contract)
      && (s.dimensions.longevity || s.dimensions.contract),
      `rated score rests on at least two dimensions: ${id}`);
    ok(s.grade !== 'unrated', `rated score has a letter grade: ${id}`);
    // Partial verification must not be able to produce a perfect score.
    if (s.coverage < 100) ok(s.score < 100, `score below 100 at partial coverage: ${id} (${s.score} at ${s.coverage}%)`);
  } else {
    ok(s.grade === 'unrated', `unrated score is labelled unrated: ${id}`);
    ok(s.unratedReason, `unrated score explains itself: ${id}`);
  }

  for (const [k, d] of Object.entries(s.dimensions)) {
    if (!d) continue;
    ok(d.score >= 0 && d.score <= d.max, `${k} score within its scale: ${id} (${d.score}/${d.max})`);
  }
}

/* --- contract facts only where a token was curated --- */
for (const [id, s] of all) {
  if (s.token) {
    ok(TOKENS[id], `token data exists only for curated tokens: ${id}`);
    ok(s.token.address === TOKENS[id]?.address, `token address matches curation: ${id}`);
    ok(/^0x[a-fA-F0-9]{40}$/.test(s.token.address), `token address is well formed: ${id}`);
  } else {
    ok(s.contractFlags.length === 0, `no contract flags without a contract: ${id}`);
  }
}

/* --- provenance is published, not implied --- */
ok(Object.keys(report.sources).length >= 3, 'at least three sources are named');
ok(report.generatedAt && !Number.isNaN(Date.parse(report.generatedAt)), 'generatedAt is a valid timestamp');
ok(Array.isArray(report.warnings), 'warnings array is present');
ok(Object.keys(report.rejectedMatches).length > 0, 'rejected matches are documented');

/* --- the report must not silently regress --- */
// The usual cause of a failure here is an orphan: the report was generated while
// a project existed that has since been removed (or a project was added and the
// report has not been refreshed yet). Name the offenders, so nobody has to diff
// two JSON files by hand to find out which one it is.
// Compare the key sets rather than trusting counts. The generator keeps counts in
// sync with whatever it just wrote, so a counts check can only ever catch drift
// between the report and projects.json -- which is the same thing, but stated one
// step further away from the truth. Key sets say it directly, in both directions.
{
  const reportIds = Object.keys(report.projects || {});
  const projectIds = activeProjects.map((p) => p.id);
  const orphaned = reportIds.filter((id) => !projectIds.includes(id));
  const missing = projectIds.filter((id) => !reportIds.includes(id));

  ok(
    orphaned.length === 0 && missing.length === 0,
    'the report covers exactly the active projects' +
      ` (report=${reportIds.length}, active=${projectIds.length}` +
      (orphaned.length ? `; orphaned in report: ${orphaned.join(', ')}` : '') +
      (missing.length ? `; missing from report: ${missing.join(', ')}` : '') +
      ')'
  );
  ok(
    report.counts.rated + report.counts.unrated === projectIds.length,
    `rated + unrated equals active project count (${report.counts.rated + report.counts.unrated} vs ${projectIds.length})`
  );
}
ok(report.counts.withDomainAge >= Math.floor(activeProjects.length * 0.8),
  `domain age covers at least 80% of active projects (got ${report.counts.withDomainAge}/${activeProjects.length})`);
ok(report.counts.rated >= Math.floor(activeProjects.length * 0.8),
  `at least 80% of active projects are rated (got ${report.counts.rated}/${activeProjects.length})`);

/* --- an unreviewed submission must never be able to break the build --- */
// /api/submit is public and unauthenticated, and it appends a project with no
// safety record. Both of these pages used to map the raw `projects` array, so
// that one submission made getStaticPaths emit an id with no record and the
// throw below it fail the whole build -- on every push afterwards, until the
// report was refreshed. It happened on 2026-09-06.
//
// A comment asking people not to do that is not a guard, so read the source and
// assert it: getStaticPaths in these two files must not touch the raw array.
for (const rel of ['src/pages/verify/[slug].astro', 'src/pages/embed/[slug].astro']) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const start = src.indexOf('getStaticPaths');
  const end = src.indexOf('interface Props');
  const block = start >= 0 && end > start ? src.slice(start, end) : '';
  ok(
    block.includes('getActiveProjects()') && !/\bprojects\s*\.\s*map\b/.test(block),
    `${rel}: getStaticPaths must build pages from getActiveProjects(), not the raw projects array` +
      ' — otherwise one anonymous /api/submit can fail every future build'
  );
}

/*
 * A score that cannot tell two projects apart is not measuring anything. When
 * the coverage cap was a hard ceiling, 33 of 62 rated projects landed on
 * exactly 75 and the /verify index became a wall of identical numbers. This
 * guard fails if any single score ever covers more than a third of the
 * directory again.
 */
{
  const scores = all.filter(([, s]) => s.score !== null).map(([, s]) => s.score);
  const counts = new Map();
  for (const v of scores) counts.set(v, (counts.get(v) ?? 0) + 1);
  const [modeScore, modeCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  ok(modeCount <= Math.max(3, Math.floor(scores.length / 3)),
    `no single score dominates the distribution (${modeCount} of ${scores.length} sit at ${modeScore})`);
  ok(counts.size >= Math.floor(scores.length / 3),
    `scores are spread across enough distinct values (${counts.size} distinct for ${scores.length} projects)`);
}

/* --- report --- */
console.log(`curated incidents: ${curatedCount} across ${Object.keys(INCIDENTS).length} projects`);
console.log(`${pass} assertions passed`);
if (fails.length) {
  console.error(`\n${fails.length} FAILED:`);
  for (const f of fails.slice(0, 25)) console.error(`  ✗ ${f}`);
  if (fails.length > 25) console.error(`  … and ${fails.length - 25} more`);
  process.exit(1);
}
console.log('safety report OK');
