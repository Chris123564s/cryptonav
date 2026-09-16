#!/usr/bin/env node
/**
 * CryptoNav weekly digest sender (option B: self-hosted, list stays in your Supabase).
 *
 * WHAT IT DOES
 *   1. Reads confirmed subscribers from Supabase (service_role key — see SECURITY).
 *   2. Composes one digest from data already in this repo (wins/ unlocks/ airdrops/).
 *   3. Sends via Resend, in batches of <=100, each email carrying a personal
 *      unsubscribe link + RFC 8058 one-click List-Unsubscribe headers.
 *
 * SECURITY — why the service_role key is a GitHub Secret and never in Cloudflare:
 *   - The public site uses the anon key, which can only INSERT into the table
 *     (RLS: no SELECT). That is correct and must stay that way.
 *   - Reading the subscriber list requires SELECT, which only service_role has.
 *     service_role BYPASSES RLS, so it must never touch the browser, Cloudflare
 *     Pages env vars, or this script at runtime outside GitHub's runner.
 *   - It lives only as the repository secret SUPABASE_SERVICE_KEY.
 *
 * MODES
 *   node scripts/send-digest.mjs --dry-run     # compose + print, send nothing
 *   node scripts/send-digest.mjs --to=a@b.c    # send a single test email
 *   node scripts/send-digest.mjs               # real send to the whole list
 *
 * REQUIRED ENV (GitHub Secrets in the workflow)
 *   SUPABASE_URL            https://xxxx.supabase.co
 *   SUPABASE_SERVICE_KEY    service_role key (SELECT only needed)
 *   RESEND_API_KEY          re_...
 *   EMAIL_FROM              "CryptoNav <digest@cryptonav.site>"  (domain must be verified in Resend)
 *   EMAIL_POSTAL_ADDRESS    see CAN-SPAM note below — REQUIRED for real sends
 *
 * CAN-SPAM / GDPR COMPLIANCE NOTES (do not remove):
 *   - Every email MUST carry a working unsubscribe link (we add one per recipient).
 *   - US CAN-SPAM requires a physical postal address in every commercial email.
 *     Set EMAIL_POSTAL_ADDRESS to a real mailing address; the script refuses to
 *     send without it unless --dry-run/--to is used. Inventing one is not an option.
 *   - CASL/GDPR: recipients opted in via the site form with an explicit consent box.
 */
import fs from 'node:fs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const SINGLE = (args.find((a) => a.startsWith('--to=')) || '').split('=')[1] || '';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
// Tolerate the common paste mistake of wrapping the value in quotes in the GitHub
// Secrets UI — Resend rejects a leading quote as an invalid `from` format.
function cleanEnv(v, fallback) {
  const s = String(v ?? '').trim().replace(/^["']|["']$/g, '').trim();
  return s || fallback;
}
const FROM = cleanEnv(process.env.EMAIL_FROM, 'CryptoNav <onboarding@resend.dev>');
const POSTAL = cleanEnv(process.env.EMAIL_POSTAL_ADDRESS, '');
const SITE = 'https://cryptonav.site';

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8')); }
  catch { return null; }
}

// ---------- data ----------
const winsData = readJson('../src/data/wins.json');
const unlocksData = readJson('../src/data/unlocks.json');
const airdropsData = readJson('../src/data/airdrops.json');

const wins = (winsData?.wins ?? winsData ?? []);
const unlocks = (unlocksData?.unlocks ?? []);
const airdrops = (airdropsData?.airdrops ?? []);

const movers = [...wins].sort((a, b) => (b.change6h || 0) - (a.change6h || 0)).slice(0, 3);
const now = new Date();
const upcoming = [...unlocks]
  .filter((u) => new Date(u.date) >= now)
  .sort((a, b) => new Date(a.date) - new Date(b.date))
  .slice(0, 3);
const hot = [...airdrops].sort((a, b) => (b.votes || 0) - (a.votes || 0)).slice(0, 3);

const dateLabel = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- email body ----------
function compose(unsubscribeUrl) {
  const rows = (items, render) => items.map(render).join('');

  const moversHtml = rows(movers, (m) => `
    <tr><td style="padding:6px 0;border-bottom:1px solid #1e293b">
      <strong style="color:#e2e8f0">${esc(m.symbol)}</strong>
      <span style="color:#64748b;font-size:12px"> ${esc(m.name)}</span>
      <span style="float:right;color:#22c55e;font-weight:700">${m.change6h >= 0 ? '+' : ''}${Number(m.change6h).toFixed(1)}%</span>
    </td></tr>`);

  const unlocksHtml = rows(upcoming, (u) => `
    <tr><td style="padding:6px 0;border-bottom:1px solid #1e293b">
      <strong style="color:#e2e8f0">${esc(u.token)}</strong>
      <span style="color:#64748b;font-size:12px"> ${esc(u.project)}</span>
      <span style="float:right;color:#f59e0b;font-size:12px">${esc(u.date)}</span>
    </td></tr>`);

  const airdropsHtml = rows(hot, (a) => `
    <tr><td style="padding:6px 0;border-bottom:1px solid #1e293b">
      <strong style="color:#e2e8f0">${esc(a.project)}</strong>
      <span style="color:#64748b;font-size:12px"> ${esc(a.status || '')}</span>
      <span style="float:right;color:#64748b;font-size:12px">${esc(a.votes || 0)} votes</span>
    </td></tr>`);

  const section = (title, body, link) => `
    <h2 style="font-size:15px;color:#f1f5f9;margin:24px 0 8px">${title}</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px">${body}</table>
    <p style="margin:8px 0 0"><a href="${link}" style="color:#60a5fa;font-size:13px;text-decoration:none">View all on CryptoNav →</a></p>`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#0f172a;padding:24px 12px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#1e293b;border:1px solid #334155;border-radius:16px;padding:28px">
    <h1 style="font-size:18px;color:#f1f5f9;margin:0 0 4px">CryptoNav Digest</h1>
    <p style="color:#94a3b8;font-size:13px;margin:0 0 4px">Auto-compiled from public data · ${dateLabel}</p>
    <p style="color:#64748b;font-size:12px;margin:0">Market data only — not investment advice. Verify any token before interacting.</p>

    ${movers.length ? section('Top DEX 6h movers', moversHtml, `${SITE}/wins/`) : ''}
    ${upcoming.length ? section('Upcoming token unlocks', unlocksHtml, `${SITE}/unlocks/`) : ''}
    ${hot.length ? section('Hottest airdrops', airdropsHtml, `${SITE}/airdrops/`) : ''}

    <p style="margin:28px 0 0;padding-top:16px;border-top:1px solid #334155;color:#64748b;font-size:11px;line-height:1.6">
      You are receiving this because you subscribed at <a href="${SITE}" style="color:#60a5fa">cryptonav.site</a>.
      <a href="${unsubscribeUrl}" style="color:#60a5fa">Unsubscribe</a> — one click, no questions.<br>
      ${POSTAL ? esc(POSTAL) : ''}
    </p>
  </div>
</body></html>`;

  const text = [
    `CryptoNav Digest — ${dateLabel}`,
    '',
    movers.length ? 'TOP DEX 6H MOVERS\n' + movers.map((m) => `- ${m.symbol} (${m.name}): ${Number(m.change6h).toFixed(1)}%`).join('\n') : '',
    upcoming.length ? '\nUPCOMING UNLOCKS\n' + upcoming.map((u) => `- ${u.token} (${u.project}) on ${u.date}`).join('\n') : '',
    hot.length ? '\nHOTTEST AIRDROPS\n' + hot.map((a) => `- ${a.project} (${a.status || ''}, ${a.votes || 0} votes)`).join('\n') : '',
    '',
    'Market data only — not investment advice.',
    `Unsubscribe: ${unsubscribeUrl}`,
  ].filter(Boolean).join('\n');

  const subject = movers.length
    ? `CryptoNav Digest — ${movers[0].symbol} ${Number(movers[0].change6h).toFixed(0)}%, ${upcoming.length} unlocks, ${hot.length} airdrops`
    : `CryptoNav Digest — ${dateLabel}`;

  return { subject, html, text };
}

// ---------- recipients ----------
async function fetchSubscribers() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/newsletter_subscribers?select=email&order=subscribedAt.desc`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase select failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const rows = await res.json();
  const emails = [...new Set(rows.map((r) => String(r.email).trim().toLowerCase()).filter(Boolean))];
  // Skip obviously-fake test addresses (e.g. example.com left over from integration
  // tests) so we never hit Resend's "testing email only" 422 in production.
  const TEST_RE = /@(example\.(com|org|net)|test\.com|localhost|invalid|example)$/;
  return emails.filter((e) => !TEST_RE.test(e));
}

function unsubUrl(email) {
  return `${SITE}/api/unsubscribe?email=${encodeURIComponent(email)}`;
}

async function sendBatch(payloads) {
  const res = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payloads),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

// ---------- main ----------
async function main() {
  let recipients;
  if (SINGLE) {
    recipients = [SINGLE.trim().toLowerCase()];
    console.log(`Test mode: sending one email to ${recipients[0]}`);
  } else if (DRY) {
    recipients = SUPABASE_URL && SERVICE_KEY ? await fetchSubscribers() : [];
    console.log(`Dry run: composed digest, ${recipients.length} subscriber(s) found.`);
  } else {
    if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY not set');
    if (!RESEND_KEY) throw new Error('RESEND_API_KEY not set');
    if (!POSTAL) throw new Error('EMAIL_POSTAL_ADDRESS not set — CAN-SPAM requires a physical postal address in commercial email. Refusing to send.');
    recipients = await fetchSubscribers();
    console.log(`Real send: ${recipients.length} subscriber(s).`);
  }

  if (DRY) {
    const sample = compose(unsubUrl('example@example.com'));
    console.log('\n--- SUBJECT ---\n' + sample.subject);
    console.log('\n--- TEXT ---\n' + sample.text);
    console.log('\n--- recipients (first 5) ---\n' + recipients.slice(0, 5).join('\n'));
    return;
  }

  if (recipients.length === 0) { console.log('No recipients. Nothing to send.'); return; }
  if (!RESEND_KEY) throw new Error('RESEND_API_KEY not set');

  let sent = 0;
  for (let i = 0; i < recipients.length; i += 100) {
    const chunk = recipients.slice(i, i + 100);
    const payloads = chunk.map((email) => {
      const u = unsubUrl(email);
      const { subject, html, text } = compose(u);
      return {
        from: FROM,
        to: [email],
        subject,
        html,
        text,
        headers: {
          // RFC 8058 one-click unsubscribe: mail clients show a native button.
          'List-Unsubscribe': `<${u}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      };
    });
    const r = await sendBatch(payloads);
    if (!r.ok) throw new Error(`Resend batch failed: HTTP ${r.status} ${r.body.slice(0, 300)}`);
    sent += chunk.length;
    console.log(`  batch sent: ${sent}/${recipients.length}`);
  }
  console.log(`Done. ${sent} email(s) sent.`);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
