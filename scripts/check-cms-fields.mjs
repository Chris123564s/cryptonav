// Audit public/admin/config.yml against the JSON files it edits.
//
// Why this exists: Decap CMS rewrites the whole JSON file on save. Any field the
// config does NOT declare is silently dropped -- no error, no warning. It bit us
// once: config.yml declared metrics.users/volume/tvl (string) while the data
// actually had tvl/volume24h/marketCapRank/twitterFollowers/githubStars (number),
// so saving any project wiped four metrics, injected an unread "users" field and
// turned the survivors into strings. And because a data workflow later writes the
// numbers back, nobody noticed for months.
//
// So: actual-but-undeclared is the dangerous direction. That is what fails here.
// Declared-but-absent is only reported as a note (it adds an empty field).

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const ROOT = process.cwd();
const CONFIG = path.join(ROOT, 'public/admin/config.yml');

const problems = [];
const notes = [];

// ---- declared fields -------------------------------------------------------

function walkDeclared(fields, prefix, out, isRoot) {
  for (const f of fields || []) {
    if (!f || !f.name) continue;
    const hasNested = Array.isArray(f.fields) && f.fields.length > 0;
    // In a file collection the top-level field is just a wrapper around the item
    // shape (e.g. `projects` -> widget: list -> fields: [id, name, ...]). Its own
    // name is NOT part of the item's key path, so don't prefix children with it.
    const p = isRoot && hasNested ? '' : prefix ? `${prefix}.${f.name}` : f.name;
    if (p) out.add(p);
    // Decap: object/list widgets nest via `fields`; a list of scalars uses `field`.
    if (hasNested) walkDeclared(f.fields, p, out, false);
    if (f.field && f.field.name) out.add(p ? `${p}.${f.field.name}` : f.field.name);
  }
}

// ---- actual fields ---------------------------------------------------------

function walkActual(value, prefix, out, depth) {
  if (value == null || typeof value !== 'object' || depth > 4) return;
  if (Array.isArray(value)) {
    for (const v of value) walkActual(v, prefix, out, depth + 1);
    return;
  }
  for (const [k, v] of Object.entries(value)) {
    const p = prefix ? `${prefix}.${k}` : k;
    out.add(p);
    if (v && typeof v === 'object') walkActual(v, p, out, depth + 1);
  }
}

function itemsOf(json, name) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json[name])) return json[name];
  // ads.json is an object with an `ads` array; be forgiving about the wrapper key.
  if (json && typeof json === 'object') {
    for (const v of Object.values(json)) {
      if (Array.isArray(v)) return v;
    }
    return [json];
  }
  return [];
}

// ---- run -------------------------------------------------------------------

if (!fs.existsSync(CONFIG)) {
  console.log('SKIP  public/admin/config.yml not found');
  process.exitCode = 0;
} else {
  const cfg = yaml.load(fs.readFileSync(CONFIG, 'utf8'));
  const collections = cfg?.collections || [];

  for (const col of collections) {
    for (const file of col.files || []) {
      const rel = file.file;
      const abs = path.join(ROOT, rel);

      const declared = new Set();
      walkDeclared(file.fields, '', declared, true);

      if (!fs.existsSync(abs)) {
        problems.push(`${col.name}: ${rel} — configured but the file does not exist`);
        continue;
      }

      let json;
      try {
        json = JSON.parse(fs.readFileSync(abs, 'utf8'));
      } catch (e) {
        problems.push(`${col.name}: ${rel} — JSON does not parse (${e.message})`);
        continue;
      }

      const items = itemsOf(json, col.name);
      if (items.length === 0) {
        notes.push(`${col.name}: ${rel} — no items found, skipped`);
        continue;
      }

      const actual = new Set();
      for (const it of items) walkActual(it, '', actual, 0);

      const missing = [...actual].filter((p) => !declared.has(p)).sort();
      const unused = [...declared].filter((p) => !actual.has(p)).sort();

      if (missing.length) {
        for (const p of missing) {
          problems.push(
            `${col.name}: ${rel} — "${p}" exists in the data but is NOT declared in config.yml. ` +
              `Saving from the CMS will delete it.`
          );
        }
      }
      if (unused.length) {
        notes.push(
          `${col.name}: ${rel} — declared but never present in the data: ${unused.join(', ')}`
        );
      }
    }
  }
}

// ---- report ----------------------------------------------------------------

if (notes.length) {
  console.log('NOTE (declared but absent — adds an empty field, does not destroy data):');
  for (const n of notes) console.log('  - ' + n);
  console.log('');
}

if (problems.length) {
  console.log(`FAIL  ${problems.length} field(s) would be destroyed on save:`);
  for (const p of problems) console.log('  - ' + p);
  console.log(
    '\nFix: add the missing fields to public/admin/config.yml (match the real key names AND types).'
  );
  process.exitCode = 1;
} else {
  console.log('OK — every field present in the data is declared in config.yml.');
  process.exitCode = 0;
}
