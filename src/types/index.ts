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

export type AdSlot = 'home-banner' | 'sidebar-top' | 'sidebar-bottom' | 'footer-banner' | 'inline-card';

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
