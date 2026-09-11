// Unit tests for functions/api/submit.js.
//
// This is the only endpoint that lets an anonymous visitor write into the repo,
// and every write costs one of the 500 production builds the Pages free plan
// allows per month. So the properties worth pinning down are:
//   - a submission can never publish itself (status/sponsored/verified/featured
//     are ours to set, not the caller's)
//   - a submission can never store a non-http(s) URL
//   - a submission can never be unbounded in size
// The upstream GitHub API is mocked; nothing here touches the network.
import { onRequestPost, onRequestOptions } from '../functions/api/submit.js';

let pass = 0;
let fail = 0;
function check(name, got, want) {
  if (String(got) === String(want)) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`); }
}

const TOKEN = { GITHUB_ISSUE_TOKEN: 'test-token' };

// Existing file content the endpoint will read. GitHub returns base64 with line
// breaks every 60 chars, so mimic that instead of handing it a clean string --
// if atob() ever stopped tolerating newlines this test would catch it.
function b64WithBreaks(obj) {
  const b = Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
  return b.replace(/(.{60})/g, '$1\n');
}

let projects = { projects: [] };
let calls = [];
let putBody = null;

globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), method: init.method || 'GET' });
  if ((init.method || 'GET') === 'GET') {
    return new Response(JSON.stringify({ sha: 'deadbeef', content: b64WithBreaks(projects) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  putBody = JSON.parse(init.body);
  // Apply the write so a second call sees it, like the real repo would.
  projects = JSON.parse(Buffer.from(putBody.content, 'base64').toString('utf8'));
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};

function makeReq(body, origin = 'https://cryptonav.site') {
  return new Request('https://cryptonav.site/api/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
const call = (body, env = TOKEN) => onRequestPost({ request: makeReq(body), env });
const reset = () => { calls = []; putBody = null; };

const valid = { name: 'Acme Swap', website: 'https://acme.test', category: 'exchange-dex' };

// --- required fields --------------------------------------------------------
reset();
let r = await call({ website: 'https://acme.test', category: 'exchange-dex' });
check('missing name -> 400', r.status, 400);
check('missing name -> no GitHub call', calls.length, 0);

reset();
r = await call('{not json');
check('malformed body -> 400', r.status, 400);

reset();
r = await call({ name: { evil: true }, website: 'https://acme.test', category: 'exchange-dex' });
check('non-string name -> 400', r.status, 400);

// --- website scheme ---------------------------------------------------------
reset();
r = await call({ ...valid, website: 'javascript:alert(1)' });
check('javascript: URL -> 400', r.status, 400);
check('javascript: URL -> no GitHub call', calls.length, 0);

reset();
r = await call({ ...valid, website: 'ftp://acme.test' });
check('ftp: URL -> 400', r.status, 400);

reset();
r = await call({ ...valid, website: 'not a url' });
check('garbage URL -> 400', r.status, 400);

// --- the caller cannot publish itself --------------------------------------
reset();
r = await call({
  ...valid,
  status: 'active',
  sponsored: true,
  featured: true,
  verified: true,
  audited: true,
  riskLevel: 'low',
  source: 'official',
});
check('privileged fields -> still 200', r.status, 200);
let committed = projects.projects[0];
check('caller cannot set status', committed.status, 'pending');
check('caller cannot set sponsored', committed.sponsored, false);
check('caller cannot set featured', committed.featured, false);
check('caller cannot set verified', committed.verified, false);
check('caller cannot set riskLevel', committed.riskLevel, 'medium');
check('caller cannot set source', committed.source, 'community-submit');

// --- bounded input ----------------------------------------------------------
projects = { projects: [] };
reset();
await call({ ...valid, name: 'N'.repeat(500), description: 'D'.repeat(5000) });
committed = projects.projects[0];
check('over-long name truncated to 80', committed.name.length, 80);
check('over-long description truncated to 600', committed.description.length, 600);

projects = { projects: [] };
reset();
await call({
  ...valid,
  chains: ['ethereum', ...Array.from({ length: 20 }, (_, i) => 'chain' + i), 42, null],
});
committed = projects.projects[0];
check('chains capped at 10', committed.chains.length, 10);
check('non-string chains dropped', committed.chains.every((c) => typeof c === 'string'), true);

// --- a newline in the name must not reach the commit message ---------------
projects = { projects: [] };
reset();
await call({ ...valid, name: 'Evil\n\nfix: rewrite everything' });
check('commit message is one line', putBody.message.split('\n').length, 1);
check('newline stripped from stored name', projects.projects[0].name.includes('\n'), false);

// --- duplicate --------------------------------------------------------------
projects = { projects: [{ id: 'acme-swap', name: 'Acme Swap', website: 'https://acme.test' }] };
reset();
r = await call(valid);
check('duplicate website -> 409', r.status, 409);
check('duplicate -> nothing written', putBody, null);

// --- happy path -------------------------------------------------------------
projects = { projects: [] };
reset();
r = await call(valid);
check('valid submission -> 200', r.status, 200);
check('valid submission -> wrote one project', projects.projects.length, 1);
check('id is slugified', projects.projects[0].id, 'acme-swap');
check('addedAt is a date', /^\d{4}-\d{2}-\d{2}$/.test(projects.projects[0].addedAt), true);

// --- token missing ----------------------------------------------------------
reset();
r = await call(valid, {});
check('no token -> 500', r.status, 500);
check('no token -> no GitHub call', calls.length, 0);
check('no token -> error tells them what to do', (await r.json()).error.includes('contact@cryptonav.site'), true);

// --- CORS -------------------------------------------------------------------
r = await onRequestOptions({ request: makeReq({}, 'https://evil.test') });
check('OPTIONS -> 204', r.status, 204);
check('OPTIONS -> unknown origin not echoed', r.headers.get('Access-Control-Allow-Origin'), 'https://cryptonav.site');
r = await onRequestOptions({ request: makeReq({}, 'https://cryptonav.site') });
check('OPTIONS -> allowed origin echoed', r.headers.get('Access-Control-Allow-Origin'), 'https://cryptonav.site');

console.log(`\n${pass}/${pass + fail} passed`);
process.exitCode = fail === 0 ? 0 : 1;
