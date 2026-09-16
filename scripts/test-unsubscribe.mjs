// Unit tests for functions/api/unsubscribe.js — mocks the Supabase RPC so the
// validation / success / not-found / error paths run without a live database.
//
// The endpoint answers with an HTML page (it is opened in a browser from an email
// link), so assertions use status + body text, not JSON.
import { onRequestGet, onRequestPost, onRequestOptions } from '../functions/api/unsubscribe.js';

let pass = 0;
let fail = 0;
function check(name, got, want) {
  if (String(got) === String(want)) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`); }
}

let rpcCalls = [];
let rpcResponder = () => new Response('true', { status: 200 });
globalThis.fetch = async (url, init) => {
  rpcCalls.push({ url, init });
  return rpcResponder(url, init);
};

const call = (email, env = {}, method = 'GET') => {
  const u = `https://cryptonav.site/api/unsubscribe?email=${encodeURIComponent(email)}`;
  const req = new Request(u, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify({ email }) : undefined,
  });
  const fn = method === 'POST' ? onRequestPost : onRequestGet;
  return fn({ request: req, env, waitUntil() {} });
};

const ENV = { NEWSLETTER_ENDPOINT: 'https://x.supabase.co/rest/v1/newsletter_subscribers', NEWSLETTER_TOKEN: 'key' };

// --- missing email ---
rpcCalls = [];
{
  const r = await call('', {});
  check('empty email -> 400', r.status, 400);
  check('empty email -> no RPC call', rpcCalls.length, 0);
}

// --- unconfigured (no endpoint) ---
rpcCalls = [];
{
  const r = await call('a@b.com', {});
  const body = await r.text();
  check('no endpoint -> 503', r.status, 503);
  check('no endpoint -> mentions unavailable', /unavailable/i.test(body), true);
  check('no endpoint -> no RPC call', rpcCalls.length, 0);
}

// --- success: removed true ---
rpcCalls = [];
rpcResponder = () => new Response('true', { status: 200 });
{
  const r = await call('reader@example.com', ENV);
  const body = await r.text();
  check('removed=true -> 200', r.status, 200);
  check('removed=true -> page says removed', /removed from the CryptoNav digest/i.test(body), true);
  check('removed=true -> one RPC call', rpcCalls.length, 1);
  check('RPC url is rpc endpoint', rpcCalls[0].url, 'https://x.supabase.co/rest/v1/rpc/newsletter_unsubscribe');
  check('RPC sends apikey + bearer', !!rpcCalls[0].init.headers.apikey && !!rpcCalls[0].init.headers.Authorization, true);
  check('RPC body has target_email', JSON.parse(rpcCalls[0].init.body).target_email, 'reader@example.com');
}

// --- success: address not on list (false) ---
rpcCalls = [];
rpcResponder = () => new Response('false', { status: 200 });
{
  const r = await call('ghost@example.com', ENV);
  const body = await r.text();
  check('removed=false -> 200', r.status, 200);
  check('removed=false -> page says not on list', /not on our list/i.test(body), true);
}

// --- email lowercased before RPC ---
rpcCalls = [];
rpcResponder = () => new Response('true', { status: 200 });
{
  await call('MiXeD@Example.COM', ENV);
  check('email lowercased', JSON.parse(rpcCalls[0].init.body).target_email, 'mixed@example.com');
}

// --- upstream error ---
rpcCalls = [];
rpcResponder = () => new Response('boom', { status: 500 });
{
  const r = await call('a@b.com', ENV);
  const body = await r.text();
  check('upstream 500 -> 502', r.status, 502);
  check('upstream 500 -> manual fallback offered', /contact@cryptonav\.site/.test(body), true);
}

// --- POST JSON body ---
rpcCalls = [];
rpcResponder = () => new Response('true', { status: 200 });
{
  const r = await call('poster@example.com', ENV, 'POST');
  check('POST body -> 200', r.status, 200);
  check('POST body -> RPC called', rpcCalls.length, 1);
}

// --- OPTIONS preflight ---
{
  const r = await onRequestOptions();
  check('OPTIONS -> 204', r.status, 204);
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
