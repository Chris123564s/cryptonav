// One-off data backfill: adds the `chains` array to projects that were missing
// it, so ProjectCard can show chain badges and /chain/[slug] can list the
// curated projects that actually run on each chain.
//
// Chains are assigned on "is this product deployed on / natively supports this
// chain". Purely chain-agnostic entries (news media, audit firms, tax tools,
// airdrop calendars) are deliberately left empty — putting chain chips on
// Cointelegraph would be wrong data, not better data.
import fs from 'node:fs';

const FILE = 'src/data/projects.json';
const VALID = new Set(
  JSON.parse(fs.readFileSync('src/data/chains.json', 'utf8')).map((c) => c.id)
);

const CHAINS = {
  'dexscreener': ['ethereum', 'solana', 'bsc', 'arbitrum', 'base', 'polygon', 'avalanche', 'optimism', 'sui', 'ton'],
  'ave-ai': ['ethereum', 'solana', 'bsc', 'arbitrum', 'base', 'polygon', 'avalanche', 'optimism'],
  'dextools': ['ethereum', 'bsc', 'solana', 'arbitrum', 'polygon', 'base', 'avalanche', 'optimism'],
  'arkham': ['ethereum', 'bsc', 'solana', 'arbitrum', 'base', 'polygon', 'avalanche', 'optimism', 'sui'],
  'nansen': ['ethereum', 'solana', 'arbitrum', 'base', 'polygon', 'bsc', 'avalanche', 'optimism', 'sui', 'ton'],

  'gmgn-ai': ['solana', 'ethereum', 'base', 'bsc', 'polygon'],
  'bullx': ['solana', 'ethereum', 'base', 'bsc', 'polygon'],
  'photon': ['solana', 'ethereum', 'base', 'bsc'],

  'stargate': ['ethereum', 'bsc', 'arbitrum', 'polygon', 'optimism', 'base', 'avalanche'],
  'across': ['ethereum', 'arbitrum', 'optimism', 'polygon', 'base', 'bsc'],

  'aave': ['ethereum', 'polygon', 'avalanche', 'arbitrum', 'optimism', 'base', 'bsc'],
  'compound': ['ethereum', 'arbitrum', 'polygon', 'base', 'optimism'],

  'makerdao': ['ethereum', 'arbitrum', 'optimism', 'base'],

  'lido': ['ethereum', 'arbitrum', 'optimism', 'base', 'polygon'],
  'yearn': ['ethereum', 'arbitrum', 'optimism', 'polygon', 'bsc'],

  'dydx': ['ethereum'],

  'sushiswap': ['ethereum', 'arbitrum', 'polygon', 'bsc', 'avalanche', 'optimism', 'base'],

  'ethereum': ['ethereum'],
  'solana': ['solana'],
  'bsc': ['bsc'],
  'arbitrum': ['arbitrum'],
  'optimism': ['optimism'],
  'base': ['base'],

  'coingecko': ['ethereum', 'solana', 'bsc', 'arbitrum', 'base', 'polygon', 'avalanche', 'optimism', 'sui', 'ton'],
  'coinmarketcap': ['ethereum', 'solana', 'bsc', 'arbitrum', 'base', 'polygon', 'avalanche', 'optimism', 'sui', 'ton'],

  'dune': ['ethereum', 'solana', 'arbitrum', 'base', 'polygon', 'bsc', 'avalanche', 'optimism', 'sui', 'ton'],
  'defillama': ['ethereum', 'solana', 'arbitrum', 'base', 'polygon', 'bsc', 'avalanche', 'optimism', 'sui', 'ton'],

  'etherscan': ['ethereum', 'arbitrum', 'optimism', 'base', 'bsc', 'polygon'],
  'solscan': ['solana'],

  'opensea': ['ethereum', 'polygon', 'solana', 'base', 'arbitrum', 'optimism', 'bsc', 'avalanche'],
  'blur': ['ethereum', 'base'],
  'magic-eden': ['solana', 'ethereum', 'polygon', 'base', 'arbitrum'],

  'ledger': ['ethereum', 'solana', 'bsc', 'polygon', 'avalanche', 'arbitrum', 'optimism', 'base'],
  'trezor': ['ethereum', 'bsc', 'polygon', 'avalanche', 'arbitrum', 'optimism', 'base'],

  'rabby': ['ethereum', 'bsc', 'polygon', 'arbitrum', 'optimism', 'base', 'avalanche'],

  'safe': ['ethereum', 'polygon', 'bsc', 'arbitrum', 'optimism', 'base', 'avalanche'],

  'zerion': ['ethereum', 'bsc', 'polygon', 'arbitrum', 'optimism', 'base', 'avalanche'],
  'debank': ['ethereum', 'bsc', 'polygon', 'arbitrum', 'optimism', 'base', 'avalanche'],
};

const raw = fs.readFileSync(FILE, 'utf8');
const doc = JSON.parse(raw);
const projects = doc.projects ?? doc;

let added = 0;
let skipped = 0;
const badIds = [];
const unknown = [];

for (const p of projects) {
  if (p.chains && p.chains.length) { skipped++; continue; }
  const list = CHAINS[p.id];
  if (!list) { unknown.push(p.id); continue; }
  for (const c of list) if (!VALID.has(c)) badIds.push(`${p.id}:${c}`);
  p.chains = list;
  added++;
}

if (badIds.length) {
  console.error('INVALID chain ids (aborting):', badIds.join(', '));
  process.exit(1);
}

fs.writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n');

const stillEmpty = projects.filter((p) => !p.chains || !p.chains.length).map((p) => p.id);
console.log('filled:', added, '| already had chains:', skipped);
console.log('no mapping (left empty):', unknown.length, '->', unknown.join(', '));
console.log('projects still without chains:', stillEmpty.length);
console.log('  ', stillEmpty.join(', '));
