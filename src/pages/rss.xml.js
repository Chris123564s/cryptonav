// Static RSS 2.0 feed endpoint. Build-time only (no runtime server needed):
// Astro renders this .js route at build into dist/rss.xml.
// Aggregates the site's auto-refreshed data: DEX momentum, learn guides, airdrops.
import winsData from '../data/wins.json';
import learnData from '../data/learn.json';
import airdropsData from '../data/airdrops.json';

const SITE = 'https://cryptonav.site';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildItems() {
  const items = [];

  // 1) DEX Momentum Watch (auto-refreshed daily)
  const wins = (winsData && winsData.wins) || winsData || [];
  const winDate = (wins[0] && wins[0].date) || '';
  for (const w of wins.slice(0, 10)) {
    const chg = w.change6h != null ? `${w.change6h >= 0 ? '+' : ''}${w.change6h.toFixed(1)}%` : '';
    items.push({
      title: `DEX Momentum: ${w.symbol} (${w.name}) ${chg} in 6h`,
      link: `https://dexscreener.com/${w.chain}/${w.address}`,
      guid: `wins:${w.address}:${winDate}`,
      pubDate: winDate,
      desc: `${w.symbol} moved ${chg} over 6h on ${w.chain} (price ${w.price}). Auto-snapshot from DexScreener. Market data only — not investment advice. Verify any token on CryptoNav before interacting.`,
    });
  }

  // 2) Learn guides
  const articles = (learnData && learnData.articles) || [];
  for (const a of articles.slice(0, 20)) {
    items.push({
      title: a.title,
      link: `${SITE}/learn/${a.slug}/`,
      guid: `learn:${a.slug}`,
      pubDate: a.publishedAt || '',
      desc: a.description || '',
    });
  }

  // 3) Airdrops (auto-refreshed every 12h)
  const air = (airdropsData && airdropsData.airdrops) || [];
  const airFetched = airdropsData.lastFetched || '';
  for (const d of air.slice(0, 15)) {
    items.push({
      title: `Airdrop: ${d.project}${d.status ? ` (${d.status})` : ''}`,
      link: d.sourceUrl || d.claimUrl || `${SITE}/airdrops/`,
      guid: `airdrop:${d.id}`,
      pubDate: airFetched ? airFetched.slice(0, 10) : '',
      desc: `${d.project} airdrop${d.actions ? ` — ${d.actions}` : ''}. Tracked on CryptoNav. Last refreshed ${airFetched.slice(0, 10)}.`,
    });
  }

  return items;
}

export function GET() {
  const items = buildItems();
  const now = new Date().toUTCString();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>CryptoNav — Daily Crypto Data &amp; Guides</title>
    <link>${SITE}/</link>
    <description>CryptoNav aggregates auto-refreshed crypto data — DEX momentum movers, token unlocks, airdrops, and beginner guides. Not investment advice.</description>
    <language>en</language>
    <lastBuildDate>${now}</lastBuildDate>
    <atom:link xmlns:atom="http://www.w3.org/2005/Atom" href="${SITE}/rss.xml" rel="self" type="application/rss+xml" />
    ${items
      .map(
        (it) => `    <item>
      <title>${esc(it.title)}</title>
      <link>${esc(it.link)}</link>
      <guid isPermaLink="false">${esc(it.guid)}</guid>
      ${it.pubDate ? `<pubDate>${esc(new Date(it.pubDate).toUTCString())}</pubDate>` : ''}
      <description>${esc(it.desc)}</description>
    </item>`
      )
      .join('\n')}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}
