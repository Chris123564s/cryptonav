// Cloudflare Pages Function: GET/POST /api/unsubscribe?email=...
//
// One-click unsubscribe for the newsletter. Calls the Supabase RPC
// newsletter_unsubscribe(text) (SECURITY DEFINER, delete-by-email, returns bool).
//
// WHY IT DERIVES THE URL: NEWSLETTER_ENDPOINT is already set in Cloudflare
// (…/rest/v1/newsletter_subscribers). The RPC lives at …/rest/v1/rpc/<name>,
// so we can compute it instead of asking the operator to add another variable.
//
// The same publishable/anon key is reused from NEWSLETTER_TOKEN. We send BOTH
// `apikey` and `Authorization: Bearer` because Supabase PostgREST needs the key in
// `apikey` for the new sb_publishable_* keys (sending only Authorization gives
// PGRST301 for non-JWT keys).

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors() },
  });
}

function rpcUrl(endpoint) {
  // https://x.supabase.co/rest/v1/newsletter_subscribers -> https://x.supabase.co/rest/v1/rpc/newsletter_unsubscribe
  const m = String(endpoint || '').match(/^(https?:\/\/[^/]+)\/rest\/v1\//);
  return m ? `${m[1]}/rest/v1/rpc/newsletter_unsubscribe` : null;
}

async function unsubscribe(email, env) {
  const url = rpcUrl(env.NEWSLETTER_ENDPOINT);
  const key = env.NEWSLETTER_TOKEN;
  if (!url || !key) return { ok: false, unconfigured: true };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ target_email: email }),
  });

  if (res.ok) {
    const removed = await res.json().catch(() => null);
    // RPC returns boolean: true = removed, false = address was not on the list.
    // Both are a successful outcome for the visitor (they are now not subscribed).
    return { ok: true, removed: removed === true };
  }
  const detail = await res.text().catch(() => '');
  return { ok: false, status: res.status, detail: detail.slice(0, 300) };
}

function html(title, message) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} — CryptoNav</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:48px 16px">
  <div style="max-width:480px;margin:0 auto;background:#1e293b;border:1px solid #334155;border-radius:16px;padding:32px;text-align:center">
    <h1 style="font-size:20px;margin:0 0 12px">${title}</h1>
    <p style="font-size:14px;color:#94a3b8;line-height:1.6;margin:0 0 24px">${message}</p>
    <a href="https://cryptonav.site/" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:10px">Back to CryptoNav</a>
  </div>
</body></html>`;
}

async function handle(request, env) {
  const url = new URL(request.url);
  let email = url.searchParams.get('email') || '';

  // Allow POST form/JSON bodies too (mail clients sometimes POST).
  if (!email && request.method === 'POST') {
    try {
      const ct = request.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const b = await request.json();
        email = String(b.email || '');
      } else {
        const form = await request.formData();
        email = String(form.get('email') || '');
      }
    } catch { /* fall through to empty */ }
  }

  email = email.trim().toLowerCase();
  if (!email) {
    return new Response(html('Unsubscribe', 'No email address was provided in the link.'), {
      status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const result = await unsubscribe(email, env);

  if (result.unconfigured) {
    return new Response(
      html('Unsubscribe', 'Unsubscribe is temporarily unavailable. Please email contact@cryptonav.site and we will remove you manually.'),
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
  if (!result.ok) {
    return new Response(
      html('Something went wrong', 'We could not process the unsubscribe just now. Please email contact@cryptonav.site and we will remove you manually.'),
      { status: 502, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  const msg = result.removed
    ? 'You have been removed from the CryptoNav digest. You will not receive further emails.'
    : 'That address is not on our list — no action needed. You will not receive the digest.';
  return new Response(html('Unsubscribed', msg), {
    status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestGet({ request, env }) {
  return handle(request, env);
}
export async function onRequestPost({ request, env }) {
  return handle(request, env);
}
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors() });
}
