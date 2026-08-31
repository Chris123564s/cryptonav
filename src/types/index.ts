// CryptoNav 类型定义

export interface ProjectData {
  id: string;
  name: string;
  symbol?: string;
  logo: string;
  category: string;
  subcategory?: string;
  tags: string[];
  description: string;
  website: string;
  referral?: string;
  social?: {
    twitter?: string;
    telegram?: string;
    discord?: string;
    github?: string;
    reddit?: string;
  };
  metrics?: {
    price?: number;
    marketCap?: number;
    marketCapRank?: number;
    volume24h?: number;
    priceChange24h?: number;
    tvl?: number;
    tvlRank?: number;
    chain?: string[];
    twitterFollowers?: number;
    githubStars?: number;
  };
  verified?: boolean;
  audited?: boolean;
  riskLevel?: 'low' | 'medium' | 'high';
  warnings?: string[];
  chains?: string[];
  featured?: boolean;
  sponsored?: boolean;
  sponsoredUntil?: string;
  status: 'active' | 'pending-review' | 'inactive' | 'delisted';
  source: 'coingecko' | 'defillama' | 'github' | 'community' | 'manual';
  addedAt: string;
  updatedAt?: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  icon: string;
  description: string;
  subcategories: SubCategory[];
}

export interface SubCategory {
  id: string;
  name: string;
  slug: string;
  description?: string;
}

export interface AdConfig {
  id: string;
  slot: AdSlot;
  title: string;
  subtitle?: string;
  image: string;
  gradient?: string;
  link: string;
  startAt: string;
  endAt: string;
  weight: number;
  active: boolean;
}

export type AdSlot = 'home-banner' | 'sidebar-top' | 'sidebar-bottom' | 'footer-banner' | 'inline-card' | 'article-top' | 'article-bottom' | 'learn-banner';

/**
 * Fallback fill for an ad slot: a mainstream crypto site from projects.json.
 * `link` is resolved at render time via getReferralUrl(), so it picks up the
 * affiliate code from affiliates.json as soon as one is configured.
 */
export interface NetworkPromo {
  projectId: string;
  title: string;
  subtitle?: string;
  cta?: string;
  gradient?: string;
  link: string;
}

export interface FeaturedItem {
  projectId: string;
  reason: string;
  order: number;
}

export interface TickerCoin {
  id: string;
  symbol: string;
  name: string;
  image: string;
  currentPrice: number;
  priceChangePercentage24h: number;
}

export interface Chain {
  id: string;
  name: string;
  slug: string;
  symbol: string;
  color: string;
  logo: string;
  description: string;
  website: string;
  tvlRank: number;
}

export interface Token {
  id: string;
  name: string;
  symbol: string;
  logo: string;
  chainId: string;
  price: number;
  marketCap: number;
  marketCapRank?: number;
  volume24h: number;
  priceChange24h: number;
  priceChange7d?: number;
  tvl?: number;
  category: string;
  contractAddress?: string;
  website: string;
  verified?: boolean;
  sponsored?: boolean;
  sponsoredUntil?: string;
  addedAt: string;
}

/* ------------------------------------------------------------------ *
 * Safety verification — produced by scripts/build-safety-report.mjs.
 *
 * Every field that reaches a page is either read from a named external
 * source or derived from one. Nothing here is hand-written: the old
 * `verified` / `riskLevel` flags on ProjectData were assertions with no
 * evidence behind them, and this replaces them.
 * ------------------------------------------------------------------ */

export type SafetyGrade = 'A' | 'B' | 'C' | 'D' | 'E' | 'unrated';
export type AgeConfidence = 'high' | 'medium' | 'low' | 'unknown';

export interface SafetyIncident {
  date: string;
  dateTs: number;
  name: string;
  amountUsd: number | null;
  technique: string | null;
  targetType: string | null;
  returnedFunds: string | null;
  source: string;
}

export interface SafetyToken {
  symbol: string;
  chain: number;
  address: string;
  holderCount: number | null;
  isOpenSource: boolean;
  isHoneypot: boolean;
  isMintable: boolean;
  isProxy: boolean;
  canTakeBackOwnership: boolean;
}

export interface SafetyDimension {
  score: number;
  max: number;
  weight: number;
  penalty?: number;
}

export interface SafetyProject {
  name: string;
  category: string;
  domain: string;
  website: string;
  domainRegisteredAt: string | null;
  domainRegistrar: string | null;
  firstSeenAt: string | null;
  operatingSince: string | null;
  ageYears: number | null;
  ageConfidence: AgeConfidence;
  ageNote: string | null;
  incidents: SafetyIncident[];
  incidentCount: number;
  incidentTotalUsd: number;
  token: SafetyToken | null;
  contractFlags: string[];
  dimensions: {
    longevity: SafetyDimension | null;
    incidents: SafetyDimension | null;
    contract: SafetyDimension | null;
  };
  score: number | null;
  grade: SafetyGrade;
  coverage: number;
  verifiedChecks: number;
  totalChecks: number;
  unratedReason: string | null;
}

export interface SafetyReport {
  generatedAt: string;
  method: string;
  weights: Record<string, number>;
  counts: Record<string, number>;
  sources: Record<string, string>;
  rejectedMatches: Record<string, string>;
  warnings: string[];
  notes: string[];
  projects: Record<string, SafetyProject>;
}
