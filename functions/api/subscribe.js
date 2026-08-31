// Cloudflare Pages Function: POST /api/subscribe
//
// Accepts an email address from the newsletter form and hands it to whatever
// email provider you configured. It deliberately does NOT talk to an SMTP
// server or send mail itself — Pages Functions have no outbound SMTP, and an
// endpoint that sends arbitrary mail would be an open relay.
//
// SETUP (Cloudflare Pages -> Settings -> Environment variables)
//   NEWSLETTER_PROVIDER  "generic" | "mailchimp" | "buttondown"   (default: generic)
//   NEWSLETTER_ENDPOINT  full subscribe URL from your provider    (required)
//   NEWSLETTER_TOKEN     provider API key                         (Secret; optional for generic)
//
//   generic    -> POST {"email","source","subscribedAt","site"} with optional Bearer token.
//                 Works with Formspree, n8n/Make/Zapier webhooks, or any own backend.
//   buttondown -> POST {"email_address","metadata"} with `Authorization: Token <key>`.
//   mailchimp  -> POST {"email_address","status":"subscribed","merge_fields"} with
//                 Basic auth (`any:<api key>`). Endpoint is the list members URL.
//
// Remember: env vars are Bindings, so a redeploy is required after changing them.
// If NEWSLETTER_ENDPOINT is unset the endpoint returns 503 and the frontend falls
// back to a mailto link, so the form is never silently broken.

const MAX_EMAIL_LEN = 254;
// Deliberately permissive: real validation happens when the provider sends the
// confirmation mail. Being stricter here only rejects valid addresses.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

function json(body, status, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      ...extra,
    },
  });
}

function buildRequest(email, source, origin, env) {
  const provider = (env.NEWSLETTER_PROVIDER || 'generic').toLowerCase();
  const endpoint = env.NEWSLETTER_ENDPOINT;
  if (!endpoint) return null;

  const headers = { 'Content-Type': 'application/json' };
  let payload;

  if (provider === 'buttondown') {
    headers.Authorization = `Token ${env.NEWSLETTER_TOKEN || ''}`;
    payload = { email_address: email, metadata: { source: source || '', site: origin } };
  } else if (provider === 'mailchimp') {
    // Mailchimp uses HTTP Basic with any username and the API key as password.
    const basic = btoa(`cryptonav:${env.NEWSLETTER_TOKEN || ''}`);
    headers.Authorization = `Basic ${basic}`;
    payload = {
      email_address: email,
      status: 'subscribed',
      merge_fields: { SOURCE: source || origin },
    };
  } else {
    if (env.NEWSLETTER_TOKEN) headers.Authorization = `Bearer ${env.NEWSLETTER_TOKEN}`;
    payload = {
      email,
      source: source || '',
      subscribedAt: new Date().toISOString(),
      site: origin,
    };
  }

  return fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload) });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid request body.' }, 400);
  }

  // Honeypot: real users never fill a hidden field, bots usually do.
  if (body.website) return json({ ok: true });

  const email = String(body.email || '').trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL_LEN || !EMAIL_RE.test(email)) {
    return json({ ok: false, error: 'Please enter a valid email address.' }, 400);
  }

  if (!env.NEWSLETTER_ENDPOINT) {
    return json(
      { ok: false, error: 'Newsletter is not configured yet.', unconfigured: true },
      503
    );
  }

  const origin = new URL(request.url).origin;
  const upstream = buildRequest(email, String(body.source || ''), origin, env);
  if (!upstream) return json({ ok: false, error: 'Newsletter is not configured yet.', unconfigured: true }, 503);

  try {
    const res = await upstream;
    // Mailchimp/Buttondown return 200 even for an address already on the list,
    // which is exactly what we want to show the visitor: a success message.
    if (res.ok || res.status === 400) {
      return json({ ok: true });
    }
    return json({ ok: false, error: 'Subscription failed. Please try again later.' }, 502);
  } catch {
    return json({ ok: false, error: 'Subscription failed. Please try again later.' }, 502);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
