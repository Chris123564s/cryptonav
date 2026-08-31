/**
 * One-shot migration: rewrite the SEO metadata in learn.json, categories.json
 * and comparisons.json.
 *
 * Surgical string replacement rather than JSON.parse + JSON.stringify. The
 * round-trip looks cleaner and is not: it reflows every hand-formatted inline
 * object in the file onto multiple lines, which turned a 30-line content change
 * into an 865-line diff. Reviewers cannot see the actual edit through that.
 *
 * Every replacement asserts it matched exactly once, so a stale `from` string
 * fails loudly instead of silently doing nothing.
 */
import fs from 'node:fs';

const edits = [
  // ---- learn.json: titles must fit 60 chars now that /learn/[slug] no longer
  // appends " | CryptoNav"; descriptions must land inside 70-160.
  ['src/data/learn.json',
    '"title": "What Is Staking in Crypto? A Complete Beginner\'s Guide (2026)"',
    '"title": "What Is Staking in Crypto? A Beginner\'s Guide (2026)"'],
  ['src/data/learn.json',
    '"description": "Staking lets you earn passive income by locking up crypto to secure a blockchain. Learn how staking works, which coins to stake, expected returns, and the risks involved."',
    '"description": "Staking lets you earn passive income by locking up crypto to secure a blockchain. Learn how staking works, which coins to stake, and the risks involved."'],

  ['src/data/learn.json',
    '"title": "What Is a Stablecoin? The Complete Guide to Crypto Price Stability (2026)"',
    '"title": "What Is a Stablecoin? Crypto Price Stability Explained"'],
  ['src/data/learn.json',
    '"description": "Stablecoins are cryptocurrencies pegged to stable assets like the US dollar. Learn how USDT, USDC, DAI, and other stablecoins work, their collateral models, and why they\'re critical to the crypto ecosystem."',
    '"description": "Stablecoins are cryptocurrencies pegged to stable assets like the US dollar. Learn how USDT, USDC and DAI work, their collateral models, and why they matter."'],

  ['src/data/learn.json',
    '"title": "What Is DeFi? Decentralized Finance Explained for Beginners (2026)"',
    '"title": "What Is DeFi? Decentralized Finance Explained"'],
  ['src/data/learn.json',
    '"description": "DeFi (Decentralized Finance) lets you lend, borrow, trade, and earn interest on crypto without banks. Learn how DeFi protocols work, key platforms, risks, and how to get started."',
    '"description": "DeFi lets you lend, borrow, trade and earn interest on crypto without banks. Learn how DeFi protocols work, the key platforms, the risks, and how to start."'],

  ['src/data/learn.json',
    '"title": "How to Read Crypto Charts: A Beginner\'s Guide to Technical Analysis (2026)"',
    '"title": "How to Read Crypto Charts: A Beginner\'s Guide"'],

  ['src/data/learn.json',
    '"description": "Web3 is the next generation of the internet, built on blockchain technology. Learn what Web3 is, how it differs from Web1 and Web2, key concepts, and why it matters."',
    '"description": "Web3 is the next generation of the internet, built on blockchain. Learn what Web3 is, how it differs from Web1 and Web2, and why it matters."'],

  ['src/data/learn.json',
    '"title": "Ethereum Layer 2 Scaling Solutions Explained: Arbitrum, Optimism, Base & More (2026)"',
    '"title": "Ethereum Layer 2 Explained: Arbitrum, Optimism & Base"'],

  ['src/data/learn.json',
    '"title": "Bitcoin vs Ethereum: What\'s the Difference? A Complete Comparison (2026)"',
    '"title": "Bitcoin vs Ethereum: What\'s the Difference?"'],
  ['src/data/learn.json',
    '"description": "Bitcoin is digital gold; Ethereum is a decentralized computer. Learn the key differences between Bitcoin and Ethereum, their use cases, consensus mechanisms, and which is a better investment."',
    '"description": "Bitcoin is digital gold; Ethereum is a decentralized computer. Learn how they differ on use cases, consensus, supply and what each is better for."'],

  ['src/data/learn.json',
    '"title": "What Does Market Cap Mean in Crypto? A Simple Explanation (2026)"',
    '"title": "What Does Market Cap Mean in Crypto?"'],
  ['src/data/learn.json',
    '"description": "Market cap measures a cryptocurrency\'s total value. Learn how crypto market cap is calculated, why it matters, the difference between FDV and market cap, and how to use it for investment decisions."',
    '"description": "Market cap measures a cryptocurrency\'s total value. Learn how it is calculated, why it matters, how it differs from FDV, and how to use it."'],

  // ---- comparisons.json
  ['src/data/comparisons.json',
    '"title": "Binance vs Coinbase: Which Crypto Exchange Is Better in 2026?"',
    '"title": "Binance vs Coinbase: Which Exchange Wins in 2026?"'],
];

/*
 * Categories get two new fields each rather than a rewrite of `description`,
 * because `description` is the hover-hint text rendered on the page. `{n}` is
 * substituted with the live project count at render time — hard-coding the
 * number is a claim that goes stale the next time a project is added.
 */
const CATEGORY_META = {
  exchange: [
    'Best Crypto Exchanges 2026: CEX & DEX Compared',
    'Compare centralized and decentralized crypto exchanges on fees, chains, security record and KYC. {n} platforms, each with a public safety score.',
  ],
  wallet: [
    'Best Crypto Wallets 2026: Hot & Cold Storage',
    'Compare self-custody and custodial crypto wallets on key control, chain support, backup model and security history. {n} wallets with safety scores.',
  ],
  market: [
    'Crypto Market Data & Analytics Tools',
    'Price aggregators, on-chain analytics dashboards and block explorers for tracking the crypto market. {n} tools, each with a verified safety score.',
  ],
  defi: [
    'Best DeFi Platforms & Protocols 2026',
    'Lending, DEX, staking and yield protocols compared on audit history and recorded incidents. {n} DeFi apps, each with a public safety score.',
  ],
  nft: [
    'Best NFT Marketplaces & Tools 2026',
    'NFT marketplaces, analytics dashboards and minting tools compared on fees, chain coverage and volume. {n} projects, each with a safety score.',
  ],
  infra: [
    'Crypto Infrastructure: Chains, L2s & Dev Tools',
    'Layer 1 blockchains, Layer 2 rollups, bridges and developer tooling, each with verified domain history and recorded incident data. {n} projects.',
  ],
  security: [
    'Crypto Security & Smart Contract Audit Tools',
    'Audit firms, contract scanners and transaction simulators for checking a protocol before you sign. {n} tools, each with a verified safety score.',
  ],
  media: [
    'Crypto News, Research & Community Hubs',
    'News outlets, research desks and community forums covering crypto markets and regulation, with domain age verified for each source. {n} sources.',
  ],
  tools: [
    'Crypto Utility Tools: Tax, Portfolio & Trading',
    'Portfolio trackers, tax calculators, trading terminals and alerting tools for managing crypto positions and reporting them. {n} tools listed.',
  ],
  'analytics-trading': [
    'Crypto Analytics & Copy-Trading Platforms',
    'On-chain analytics dashboards, smart-money trackers and copy-trading terminals for following wallets and trades in real time. {n} platforms.',
  ],
};

function applyOnce(text, from, to, label) {
  const n = text.split(from).length - 1;
  if (n !== 1) {
    throw new Error(`${label}: expected exactly 1 match, found ${n}\n  from: ${from}`);
  }
  return text.replace(from, to);
}

let applied = 0;
const byFile = new Map();

for (const [file, from, to] of edits) {
  if (!byFile.has(file)) byFile.set(file, fs.readFileSync(file, 'utf8'));
  byFile.set(file, applyOnce(byFile.get(file), from, to, file));
  applied += 1;
}

// Categories: insert seoTitle/seoDescription directly after each `description`.
let catText = fs.readFileSync('src/data/categories.json', 'utf8');
const cats = JSON.parse(catText);
for (const c of cats) {
  const [seoTitle, seoDescription] = CATEGORY_META[c.id];
  if (!seoTitle) throw new Error(`no metadata written for category "${c.id}"`);
  const anchor = `"description": ${JSON.stringify(c.description)}`;
  if (catText.split(anchor).length - 1 !== 1) {
    throw new Error(`categories.json: could not find a unique anchor for "${c.id}"`);
  }
  catText = catText.replace(
    anchor,
    `${anchor},\n      "seoTitle": ${JSON.stringify(seoTitle)},\n      "seoDescription": ${JSON.stringify(seoDescription)}`,
  );
  applied += 2;
}
byFile.set('src/data/categories.json', catText);

for (const [file, text] of byFile) {
  fs.writeFileSync(file, text);
}

console.log(`applied ${applied} edits across ${byFile.size} files`);
