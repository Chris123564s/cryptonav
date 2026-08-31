/**
 * Hand-curated mappings for the CryptoNav Safety Score.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * DefiLlama's /hacks feed identifies a victim either by `defillamaId` (a numeric
 * protocol id) or by a free-text `name`. Neither is safe to auto-match:
 *
 *   - `defillamaId` is missing on most CEX / wallet / NFT incidents, and
 *     protocols are versioned (Aave V1..V4 are four separate ids).
 *   - Free-text `name` matching produces false positives that would be
 *     defamatory: "Blur Finance" (a BSC exit scam) is not Blur.io, "Phantom
 *     Galaxies" is not the Phantom wallet, "Safe Dollar" is not Safe{Gnosis},
 *     "Solido Cash" is not Lido, "RocketSwap Base" is not Coinbase's Base.
 *
 * So a human decides *attribution* — which incident belongs to which project.
 * Everything else (amount, technique, date) is read from the live source at
 * build time and never hard-coded here. If a curated record disappears from the
 * upstream feed, the build warns instead of silently scoring as "no incidents".
 *
 * RULE FOR CONTRIBUTORS: when unsure, exclude. A missing incident makes the
 * score slightly too generous; a wrong one makes us liars.
 */

/**
 * project id -> list of incident keys, where key = the incident's unix
 * timestamp as it appears in DefiLlama's `date` field.
 *
 * A comment records what each entry is so the next maintainer can re-verify.
 */
export const INCIDENTS = {
  // 2022-10-06 Binance Bridge (BSC Token Hub) $570M — 2019-05-07 hot wallet $40M
  binance: [1665014400, 1557187200],
  // 2025-02-21 Bybit cold wallet $1.4B — largest crypto hack on record
  bybit: [1740096000],
  // 2023-12-13 OKX DEX aggregator — 2024-06-20 OKX NFT aggregator
  okx: [1702425600, 1718841600],
  // 2021-10-01 SMS 2FA flaw — 2025-08-13 support-channel social engineering
  coinbase: [1633046400, 1755043200],
  // 2019-06-02 Kraken, ~$10.4M of user funds
  kraken: [1559433600],
  // 2025-04-20 Bitget, whale exploit on a leveraged pair
  bitget: [1745107200],
  // 2022-07-11 Uniswap phishing airdrop $8M — 2020-04-18 Uniswap V1 imBTC pool
  uniswap: [1657497600, 1587168000],
  // 2021-03-19 PancakeSwap DNS hijack. NOTE: "PancakeSwap / Cream Finance"
  // (2021-02-??) is deliberately excluded — Cream was the exploited protocol.
  pancakeswap: [1618185600],
  // 2023-11 Curve/Vyper compiler bug $60M+ — 2022-08 Curve DNS/resolver — 2026-03 LlamaLend
  curve: [1699315200, 1660003200, 1772409600],
  sushiswap: [1611705600, 1681084800, 1606694400],
  '1inch': [1730332800, 1741305600],
  dydx: [1721692800, 1700265600],
  // 2025-12-25 Trust Wallet browser-extension supply-chain incident
  'trust-wallet': [1766620800],
  // 2020-11-06 customer-data breach (no funds) — 2023-12-14 Ledger Connect Kit
  ledger: [1604620800, 1702512000],
  aave: [1724803200, 1773273600],
  // 2021-09-29 Compound V2 COMP distribution bug $147M
  compound: [1632873600],
  // 2020-03-12 "Black Thursday" stale oracle, $8.3M of undercollateralised debt
  makerdao: [1583971200],
  yearn: [1764460800, 1612483200, 1681344000],
  stargate: [1701648000],
  across: [1784246400],
  // 2022-02-20 phishing $2M — 2022-01-25 withdrawal-logic flaw $1M
  opensea: [1645315200, 1643068800],
  zerion: [1776124800],
};

/**
 * Matches that look right and are WRONG. Kept as executable documentation so a
 * future fuzzy-matching "improvement" cannot quietly reintroduce them.
 */
export const REJECTED_MATCHES = {
  'gate-io': 'Feed has "Gate" (2018, $235M) but that attribution is contested; excluding beats being wrong.',
  blur: '"Blur Finance" is a BSC/Polygon exit scam, unrelated to Blur.io NFT marketplace.',
  phantom: '"Phantom Galaxies" is an NFT game, not the Phantom wallet.',
  safe: '"Safe Dollar" is a Polygon fork, not Safe{Gnosis}.',
  lido: '"Solido Cash" is a Supra-chain protocol, not Lido.',
  base: '"RocketSwap Base", "Grand Base", "Base Lending" are unrelated protocols.',
  ethereum: '"Verus-Ethereum Bridge" and "Ethereum Alarm Clock" are not the Ethereum protocol.',
  'ave-ai': 'Name collisions with Aave / Agave / xAVE / Save — none are Ave.ai.',
  arbitrum: 'No incident records for the Arbitrum protocol itself (bridges are separate entities).',
  optimism: 'No incident records for the Optimism protocol itself.',
};

/**
 * Projects whose token contract can be checked with GoPlus.
 *
 * Only tokens we can name with confidence are listed. Exchange platforms,
 * wallets, media and analytics sites have no token, and inventing one would
 * be worse than leaving the dimension unverified.
 *
 * chain = chain id as GoPlus expects it (1 Ethereum, 10 OP, 56 BSC, 42161 Arbitrum).
 */
export const TOKENS = {
  uniswap: { chain: 1, address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', symbol: 'UNI' },
  '1inch': { chain: 1, address: '0x111111111117dC0aa78b770fA6A738034120C302', symbol: '1INCH' },
  aave: { chain: 1, address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', symbol: 'AAVE' },
  compound: { chain: 1, address: '0xc00e94Cb662C3520282E6f5717214004A7f26888', symbol: 'COMP' },
  makerdao: { chain: 1, address: '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2', symbol: 'MKR' },
  lido: { chain: 1, address: '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32', symbol: 'LDO' },
  yearn: { chain: 1, address: '0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e', symbol: 'YFI' },
  curve: { chain: 1, address: '0xD533a949740bb3306d119CC777fa900bA034cd52', symbol: 'CRV' },
  sushiswap: { chain: 1, address: '0x6B3595068778DD592e39A122f4f5a5cF09C90fE2', symbol: 'SUSHI' },
  dydx: { chain: 1, address: '0x92D6C1e31e14520e676a687F0a93788B716BEff5', symbol: 'DYDX' },
  stargate: { chain: 1, address: '0xAf5191B0De278C7286d6C7CC6ab6BB8A73bA2Cd6', symbol: 'STG' },
  across: { chain: 1, address: '0x44108f0223A3C3028F5Fe7AEC7f9bb2E66beF82F', symbol: 'ACX' },
  blur: { chain: 1, address: '0x5283D291DBCF85356A21bA090E6db59121208b44', symbol: 'BLUR' },
  safe: { chain: 1, address: '0x5aFE3855358E112B5647B952709E6165e1c1eeEE', symbol: 'SAFE' },
  arbitrum: { chain: 42161, address: '0x912CE59144191C1204E64559FE8253a0e49E6548', symbol: 'ARB' },
  optimism: { chain: 10, address: '0x4200000000000000000000000000000000000042', symbol: 'OP' },
  pancakeswap: { chain: 56, address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', symbol: 'CAKE' },
  arkham: { chain: 1, address: '0x6Ea8aC1673402989e7B653aE4e83B54173719C30', symbol: 'ARKM' },
};

/**
 * RDAP endpoints for TLDs that IANA's bootstrap file does not list.
 * .io is operated by Identity Digital but is absent from dns.json, so without
 * this override every .io project would score as "domain age unverified".
 */
export const RDAP_OVERRIDES = {
  io: 'https://rdap.identitydigital.services/rdap/',
};
