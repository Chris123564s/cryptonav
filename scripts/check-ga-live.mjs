// End-to-end GA4 check: drives a real Chrome over CDP, loads the live site, and
// reports whether the gtag.js request and the /g/collect beacon actually fire.
//
// This is the only check that proves the tag works. `grep`ping the built HTML only
// proves the snippet is *present*: `window.gtag` and `dataLayer` are defined by our
// own inline snippet, so they look healthy even when gtag.js never loads.
//
// Usage (Chrome does NOT read the https_proxy env var, so pass it explicitly):
//   GA_PROBE_PROXY=http://127.0.0.1:<port> node scripts/check-ga-live.mjs https://cryptonav.site/
//
// Without a proxy, a mainland-China connection to googletagmanager.com fails with
// net::ERR_SSL_PROTOCOL_ERROR -> 0 collect requests -> the tag silently does nothing.
// A healthy run shows: gtagJsRequests>=1, collectRequests>=1, and both _ga cookies.
//
// READ `verdict` FIRST. A proxy can block the GA domains while still allowing the
// rest of Google, which makes a perfectly good tag look broken. The control probe
// (fonts.googleapis.com vs googletagmanager.com) detects that and says INCONCLUSIVE
// instead of letting you report a false failure. Verified 2026-09-11: this machine's
// proxy returns 200 for fonts.googleapis.com and 000 for both GA domains, so no
// run from here can confirm or deny the tag.
//
// Chrome path is Windows-specific; adjust CHROME when running elsewhere.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const TARGET = process.argv[2] || 'https://cryptonav.site/';
const profile = mkdtempSync(join(tmpdir(), 'ga-probe-'));

// Chrome ignores the https_proxy env var, so pass the proxy explicitly when asked.
// Without this, a direct connection from this machine gets ERR_SSL_PROTOCOL_ERROR
// on googletagmanager.com, which is what the un-proxied run above showed.
const proxyArg = process.env.GA_PROBE_PROXY ? [`--proxy-server=${process.env.GA_PROBE_PROXY}`] : [];

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  ...proxyArg,
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(path, method = 'GET') {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method });
  return res.json();
}

async function waitForDevTools() {
  for (let i = 0; i < 60; i++) {
    try {
      await getJson('/json/version');
      return true;
    } catch {
      await sleep(250);
    }
  }
  return false;
}

let id = 0;
function rpc(ws, method, params = {}) {
  return new Promise((resolve) => {
    const myId = ++id;
    const onMsg = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id !== myId) return;
      ws.removeEventListener('message', onMsg);
      resolve(msg.result ?? msg.error ?? {});
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
}

const hits = { gtagJs: [], collect: [], other: [] };
const net = { responses: [], failures: [] };

try {
  if (!(await waitForDevTools())) throw new Error('Chrome DevTools endpoint never came up');

  const target = await getJson(`/json/new?about:blank`, 'PUT');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });

  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.method === 'Network.responseReceived') {
      const url = msg.params?.response?.url || '';
      if (url.includes('google')) {
        net.responses.push({
          url: url.slice(0, 90),
          status: msg.params.response.status,
          mime: msg.params.response.mimeType,
        });
      }
    }
    if (msg.method === 'Network.loadingFailed') {
      net.failures.push({
        err: msg.params?.errorText,
        blocked: msg.params?.blockedReason || null,
      });
    }
    if (msg.method !== 'Network.requestWillBeSent') return;
    const url = msg.params?.request?.url || '';
    if (url.includes('googletagmanager.com/gtag/js')) hits.gtagJs.push(url);
    else if (url.includes('google-analytics.com') || url.includes('/g/collect')) hits.collect.push(url);
    else if (url.includes('google')) hits.other.push(url);
  });

  await rpc(ws, 'Network.enable');
  await rpc(ws, 'Page.enable');
  await rpc(ws, 'Runtime.enable');
  await rpc(ws, 'Page.navigate', { url: TARGET });

  // Give the tag time to load, run, and flush its beacon.
  await sleep(15000);

  const evalJs = async (expr) => {
    const r = await rpc(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true });
    return r?.result?.value;
  };

  // Control probe. A "0 collect requests" result has two very different causes and
  // the raw numbers cannot tell them apart:
  //   (a) the tag is broken, or
  //   (b) this machine's network blocks Google's tracking domains.
  // Case (b) is common on proxied/corporate networks and produces a false alarm that
  // reads exactly like a real failure. fonts.googleapis.com is the control: it is a
  // Google domain that such rules usually leave alone, so fonts=200 + gtm/ga!=200
  // means the block is a local rule, not a site problem.
  const curlCode = (url) =>
    new Promise((resolve) => {
      const args = ['-s', '-o', '/dev/null', '--max-time', '15', '-w', '%{http_code}'];
      if (process.env.GA_PROBE_PROXY) args.push('-x', process.env.GA_PROBE_PROXY);
      args.push(url);
      const p = spawn('curl', args, { stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.on('close', () => resolve(out.trim() || '000'));
    });

  const network = {
    control_fonts_googleapis: await curlCode('https://fonts.googleapis.com/css2?family=Inter'),
    googletagmanager: await curlCode('https://www.googletagmanager.com/gtag/js?id=G-MD66BHJN9Y'),
    google_analytics_collect: await curlCode(
      'https://www.google-analytics.com/g/collect?v=2&tid=G-MD66BHJN9Y'
    ),
  };

  let verdict;
  if (hits.collect.length >= 1) {
    verdict = 'TAG WORKS — gtag.js loaded and the /g/collect beacon fired.';
  } else if (network.control_fonts_googleapis === '200' && network.googletagmanager !== '200') {
    verdict =
      'INCONCLUSIVE — this machine BLOCKS googletagmanager.com (control fonts.googleapis.com ' +
      'is reachable, so there is internet; the GA domains are blocked by a local proxy/firewall ' +
      'rule). The 0 collect requests below are an artifact of this network, NOT evidence that ' +
      'the tag is broken. Re-run from an unblocked network.';
  } else if (network.control_fonts_googleapis !== '200') {
    verdict = 'INCONCLUSIVE — no working outbound path at all (proxy down or offline).';
  } else {
    verdict =
      'TAG PRESENT BUT DID NOT FIRE — the network reaches Google, yet no /g/collect beacon was ' +
      'sent. This one is real; inspect the console and the snippet.';
  }

  const report = {
    verdict,
    networkControl: network,
    target: TARGET,
    gtagJsRequests: hits.gtagJs.length,
    collectRequests: hits.collect.length,
    gtagLoaded: await evalJs('typeof window.gtag'),
    dataLayerLength: await evalJs('window.dataLayer ? window.dataLayer.length : null'),
    gaCookies: await evalJs(
      "document.cookie.split(';').map(c=>c.trim().split('=')[0]).filter(n=>n.startsWith('_ga'))"
    ),
    scriptTagPresent: await evalJs(
      "!!document.querySelector('script[src*=\"googletagmanager.com/gtag/js\"]')"
    ),
    sampleCollectUrls: hits.collect.slice(0, 3),
    sampleOther: hits.other.slice(0, 5),
    googleResponses: net.responses,
    loadFailures: net.failures,
    gtagSrcBytes: await evalJs(
      "(()=>{const s=document.querySelector('script[src*=\"googletagmanager.com/gtag/js\"]');return s?{src:s.src,async:s.async}:null})()"
    ),
  };

  console.log(JSON.stringify(report, null, 2));
  ws.close();
} catch (err) {
  console.log(JSON.stringify({ error: String(err) }, null, 2));
} finally {
  chrome.kill();
}
