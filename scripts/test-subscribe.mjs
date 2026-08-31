// Unit tests for functions/api/subscribe.js — mocks the upstream provider so
// the validation / provider-shaping / fallback paths can be checked without
// deploying.
import { onRequestPost, onRequestOptions } from '../functions/api/subscribe.js';

let pass = 0;
let fail = 0;
function check(name, got, want) {
  if (String(got) === String(want)) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`); }
}

let upstreamCalls = [];
let upstreamResponder = () => new Response('{}', { status: 200 });

globalThis.fetch = async (url, init) => {
  upstreamCalls.push({ url, init });
  return upstreamResponder(url, init);
};

function makeReq(body) {
  return new Request('https://cryptonav.site/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const call = (body, env = {}) =>
  onRequestPost({ request: makeReq(body), env, waitUntil() {} });

// --- validation ---
let r = await call({ email: 'not-an-email' }, { NEWSLETTER_ENDPOINT: 'https://x.test' });
check('invalid email -> 400', r.status, 400);
check('invalid email -> no upstream call', upstreamCalls.length, 0);
check('invalid email -> ok false', (await r.json()).ok, false);

r = await call({}, { NEWSLETTER_ENDPOINT: 'https://x.test' });
check('missing email -> 400', r.status, 400);

r = await call({ email: 'a'.repeat(250) + '@example.com' }, { NEWSLETTER_ENDPOINT: 'https://x.test' });
check('over-long email -> 400', r.status, 400);

// --- honeypot ---
upstreamCalls = [];
r = await call({ email: 'bot@example.com', website: 'http://spam.test' }, { NEWSLETTER_ENDPOINT: 'https://x.test' });
check('honeypot filled -> 200', r.status, 200);
check('honeypot filled -> no upstream call', upstreamCalls.length, 0);

// --- unconfigured ---
upstreamCalls = [];
r = await call({ email: 'reader@example.com' }, {});
check('no endpoint -> 503', r.status, 503);
let j = await r.json();
check('no endpoint -> unconfigured flag', j.unconfigured, true);
check('no endpoint -> no upstream call', upstreamCalls.length, 0);

// --- generic provider ---
upstreamCalls = [];
r = await call({ email: 'Reader@Example.com', source: 'footer' }, {
  NEWSLETTER_ENDPOINT: 'https://hooks.test/subscribe',
});
j = await r.json();
check('generic -> ok', j.ok, true);
check('generic -> status 200', r.status, 200);
check('generic -> one upstream call', upstreamCalls.length, 1);
check('generic -> url', upstreamCalls[0].url, 'https://hooks.test/subscribe');
check('generic -> method', upstreamCalls[0].init.method, 'POST');
const gBody = JSON.parse(upstreamCalls[0].init.body);
check('generic -> email lowercased+trimmed', gBody.email, 'reader@example.com');
check('generic -> source passed', gBody.source, 'footer');
check('generic -> subscribedAt present', typeof gBody.subscribedAt, 'string');

// --- generic with bearer token ---
upstreamCalls = [];
await call({ email: 'x@example.com' }, {
  NEWSLETTER_ENDPOINT: 'https://hooks.test/s',
  NEWSLETTER_TOKEN: 'secret123',
});
check('generic -> bearer header', upstreamCalls[0].init.headers.Authorization, 'Bearer secret123');

// --- buttondown ---
upstreamCalls = [];
await call({ email: 'x@example.com', source: 'newsletter-page' }, {
  NEWSLETTER_PROVIDER: 'buttondown',
  NEWSLETTER_ENDPOINT: 'https://api.buttondown.email/v1/subscribers',
  NEWSLETTER_TOKEN: 'bd-key',
});
const bd = JSON.parse(upstreamCalls[0].init.body);
check('buttondown -> email_address field', bd.email_address, 'x@example.com');
check('buttondown -> source in metadata', bd.metadata.source, 'newsletter-page');
check('buttondown -> Token auth', upstreamCalls[0].init.headers.Authorization, 'Token bd-key');

// --- mailchimp ---
upstreamCalls = [];
await call({ email: 'x@example.com' }, {
  NEWSLETTER_PROVIDER: 'mailchimp',
  NEWSLETTER_ENDPOINT: 'https://us21.api.mailchimp.com/3.0/lists/abc/members',
  NEWSLETTER_TOKEN: 'mc-key',
});
const mc = JSON.parse(upstreamCalls[0].init.body);
check('mailchimp -> email_address field', mc.email_address, 'x@example.com');
check('mailchimp -> subscribed status', mc.status, 'subscribed');
check('mailchimp -> basic auth prefix', upstreamCalls[0].init.headers.Authorization.startsWith('Basic '), true);
const decoded = Buffer.from(upstreamCalls[0].init.headers.Authorization.slice(6), 'base64').toString();
check('mailchimp -> basic auth contains key', decoded, 'cryptonav:mc-key');

// --- upstream failure ---
upstreamResponder = () => new Response('boom', { status: 500 });
r = await call({ email: 'x@example.com' }, { NEWSLETTER_ENDPOINT: 'https://x.test' });
check('upstream 500 -> 502', r.status, 502);
check('upstream 500 -> ok false', (await r.json()).ok, false);

// 400 from upstream means "already subscribed" — treat as success for the visitor.
upstreamResponder = () => new Response('{}', { status: 400 });
r = await call({ email: 'x@example.com' }, { NEWSLETTER_ENDPOINT: 'https://x.test' });
check('upstream 400 (already subscribed) -> 200', r.status, 200);

// upstream throws
globalThis.fetch = async () => { throw new Error('network down'); };
r = await call({ email: 'x@example.com' }, { NEWSLETTER_ENDPOINT: 'https://x.test' });
check('upstream throws -> 502', r.status, 502);

// --- bad JSON body ---
globalThis.fetch = async () => new Response('{}', { status: 200 });
r = await onRequestPost({
  request: new Request('https://cryptonav.site/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not json',
  }),
  env: {},
  waitUntil() {},
});
check('malformed body -> 400', r.status, 400);

// --- CORS preflight ---
const pre = await onRequestOptions();
check('OPTIONS -> 204', pre.status, 204);
check('OPTIONS -> allows POST', pre.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
