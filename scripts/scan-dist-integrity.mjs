/**
 * Scan a build output directory for things that break Cloudflare Pages publishing.
 *
 * Cloudflare emits a bare "Failed to publish assets" / "an internal error occurred"
 * with no detail, so the only way to find the cause is to rule candidates out
 * locally. This checks the ones that are cheap to check:
 *
 *   1. non-ASCII / control characters in file paths
 *   2. invalid UTF-8 in text files (a mis-encoded source data file inlined into
 *      HTML produces bytes Cloudflare's asset manifest will not accept)
 *   3. NUL bytes and lone surrogates in text files
 *   4. zero-byte files
 *   5. over-long path segments and total paths
 *   6. case-insensitive filename collisions (Windows builds hide these)
 *
 * Usage: node scripts/scan-dist-integrity.mjs [distDir]
 * Exit code 1 when anything is found.
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = process.argv[2] || 'dist';

const TEXT_EXT = new Set([
  '.html', '.htm', '.json', '.js', '.mjs', '.cjs', '.css', '.xml',
  '.txt', '.svg', '.yml', '.yaml', '.md', '.map', '.webmanifest',
]);

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(p);
  }
})(DIST);

const problems = [];
const note = (kind, detail) => problems.push({ kind, detail });

// --- 1. path hygiene -----------------------------------------------------
for (const f of files) {
  const rel = relative(DIST, f);
  // eslint-disable-next-line no-control-regex
  if (/[^\x20-\x7E]/.test(rel)) note('non-ascii-path', rel);
  if (rel.length > 240) note('path-too-long', `${rel.length} chars: ${rel.slice(0, 60)}...`);
  for (const seg of rel.split(/[\\/]/)) {
    if (seg.length > 200) note('segment-too-long', `${seg.length} chars in ${rel}`);
  }
}

// --- 2/3/4. content hygiene ---------------------------------------------
for (const f of files) {
  const rel = relative(DIST, f);
  const size = statSync(f).size;
  if (size === 0) {
    // .gitkeep exists precisely to be empty -- it keeps an otherwise empty
    // directory present in git. Flagging it would make this check permanently
    // red and therefore useless.
    if (!/^\.gitkeep$/i.test(rel.split(/[\\/]/).pop() || '')) note('empty-file', rel);
    continue;
  }
  const ext = (rel.match(/\.[A-Za-z0-9]+$/) || [''])[0].toLowerCase();
  if (!TEXT_EXT.has(ext)) continue;

  const buf = readFileSync(f);
  // NUL byte: never valid in these text formats
  if (buf.includes(0)) { note('nul-byte', rel); continue; }

  // A fatal decoder is the only reliable test. Searching for U+FFFD gives false
  // positives, because minified JS legitimately contains a literal U+FFFD
  // (e.g. `REPLACEMENT_CHARACTER = "\uFFFD"`), which is a *valid* encoding of a
  // code point rather than evidence of a bad byte.
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    // locate the first offending byte for a useful message
    let at = -1;
    for (let i = 0; i < buf.length; i++) {
      try { new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(i, i + 4)); }
      catch { at = i; break; }
    }
    const ctx = at < 0 ? '' : ` first bad byte @${at}: ${buf.subarray(Math.max(0, at - 20), at + 20).toString('hex')}`;
    note('invalid-utf8', `${rel}${ctx}`);
    continue;
  }
  const text = buf.toString('utf8');
  // lone surrogate -> breaks JSON serialisation downstream
  // eslint-disable-next-line no-control-regex
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/.test(text)) {
    note('lone-surrogate', rel);
  }
}

// --- 5. case-insensitive collisions --------------------------------------
const seen = new Map();
for (const f of files) {
  const key = relative(DIST, f).toLowerCase();
  if (seen.has(key)) note('case-collision', `${seen.get(key)} <-> ${relative(DIST, f)}`);
  else seen.set(key, relative(DIST, f));
}

// --- report --------------------------------------------------------------
console.log(`scanned ${files.length} files under ${DIST}`);
if (!problems.length) {
  console.log('OK — no integrity problems found');
  process.exit(0);
}
const byKind = new Map();
for (const p of problems) {
  if (!byKind.has(p.kind)) byKind.set(p.kind, []);
  byKind.get(p.kind).push(p.detail);
}
for (const [kind, list] of byKind) {
  console.log(`\n[${kind}] ${list.length}`);
  for (const d of list.slice(0, 15)) console.log('  -', d);
  if (list.length > 15) console.log(`  ... and ${list.length - 15} more`);
}
console.log(`\nFAIL — ${problems.length} problem(s)`);
process.exit(1);
