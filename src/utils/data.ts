import projectsData from '../data/projects.json';
import categoriesData from '../data/categories.json';
import chainsData from '../data/chains.json';
import adsData from '../data/ads.json';
import featuredData from '../data/featured.json';
import tickerData from '../data/ticker.json';
import chainTokensData from '../data/chain-tokens.json';
import affiliatesData from '../data/affiliates.json';
import adNetworkData from '../data/ad-network.json';
import type { ProjectData, Category, AdConfig, FeaturedItem, TickerCoin, AdSlot, Chain, Token } from '../types';

export const projects: ProjectData[] = (projectsData as any).projects ?? projectsData as ProjectData[];
export const categories: Category[] = categoriesData as Category[];
export const chains: Chain[] = chainsData as Chain[];
export const ads: AdConfig[] = (adsData as any).ads ?? adsData as AdConfig[];
export const featured: FeaturedItem[] = (featuredData as any).featured ?? featuredData as FeaturedItem[];
export const tickerCoins: TickerCoin[] = (tickerData as any).ticker ?? tickerData as TickerCoin[];
export const chainTokens: Token[] = chainTokensData as Token[];

/** 获取所有活跃项目 */
export function getActiveProjects(): ProjectData[] {
  return projects.filter(p => p.status === 'active');
}

/** 按 ID 获取项目 */
export function getProjectById(id: string): ProjectData | undefined {
  return projects.find(p => p.id === id);
}

/** 按分类获取项目 */
export function getProjectsByCategory(categoryId: string): ProjectData[] {
  return getActiveProjects().filter(p => p.category === categoryId);
}

/** 按父分类获取项目（赞助项目置顶） */
export function getProjectsByParentCategory(parentId: string): ProjectData[] {
  const cat = categories.find(c => c.id === parentId);
  if (!cat) return [];
  const subCatIds = cat.subcategories.map(s => s.id);
  return getActiveProjects()
    .filter(p => subCatIds.includes(p.category))
    .sort((a, b) => {
      // Sponsored projects first
      const aSponsored = a.sponsored && (!a.sponsoredUntil || new Date(a.sponsoredUntil) >= new Date());
      const bSponsored = b.sponsored && (!b.sponsoredUntil || new Date(b.sponsoredUntil) >= new Date());
      if (aSponsored && !bSponsored) return -1;
      if (!aSponsored && bSponsored) return 1;
      // Then by addedAt (newest first)
      return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
    });
}

/** 获取精选项目 */
export function getFeaturedProjects(): ProjectData[] {
  return featured
    .sort((a, b) => a.order - b.order)
    .map(f => getProjectById(f.projectId))
    .filter((p): p is ProjectData => p !== undefined);
}

/** 获取最新收录 */
export function getLatestProjects(limit = 12): ProjectData[] {
  return getActiveProjects()
    .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime())
    .slice(0, limit);
}

/** 获取分类信息 */
export function getCategoryById(id: string): Category | undefined {
  return categories.find(c => c.id === id);
}

/** 获取子分类信息 */
export function getSubCategoryById(id: string): { category: Category; subcategory: Category['subcategories'][0] } | undefined {
  for (const cat of categories) {
    const sub = cat.subcategories.find(s => s.id === id);
    if (sub) return { category: cat, subcategory: sub };
  }
  return undefined;
}

/** 获取指定广告位的活跃广告 */
export function getActiveAds(slot: AdSlot): AdConfig[] {
  const now = new Date().toISOString();
  return ads.filter(
    ad => ad.slot === slot && ad.active && ad.startAt <= now && ad.endAt >= now
  );
}

/** 获取指定广告位的一条广告（随机） */
export function getAd(slot: AdSlot): AdConfig | null {
  const activeAds = getActiveAds(slot);
  if (activeAds.length === 0) return null;
  // 按权重随机选
  const totalWeight = activeAds.reduce((sum, ad) => sum + ad.weight, 0);
  let random = Math.random() * totalWeight;
  for (const ad of activeAds) {
    random -= ad.weight;
    if (random <= 0) return ad;
  }
  return activeAds[0];
}

/** 获取项目联盟链接：优先用 affiliates.json 配置的 code 生成真实链接，否则回退到项目自带 referral/website */
export function getReferralUrl(p: ProjectData): string {
  const conf = (affiliatesData as any)?.exchanges?.[p.id];
  if (conf && conf.code) {
    return String(conf.template).replace(/\{code\}/g, conf.code);
  }
  return p.referral || p.website;
}

/** 获取广告网络（Coinzilla/Bitmedia）填充代码；html 为空时返回 null（显示 Your Ad Here 占位） */
export function getNetworkAd(slot: AdSlot): { network: string; html: string } | null {
  const entry = (adNetworkData as any)?.slots?.[slot];
  if (!entry || !entry.html) return null;
  return { network: entry.network || '', html: entry.html };
}

/** 格式化数字 */
export function formatNumber(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

/** 格式化价格 */
export function formatPrice(n: number): string {
  if (n >= 1) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  return `$${n.toFixed(4)}`;
}

/** 按 slug 获取链 */
export function getChainBySlug(slug: string): Chain | undefined {
  return chains.find(c => c.slug === slug);
}

/** 按 chain ID 获取项目（支持多链） */
export function getProjectsByChain(chainId: string): ProjectData[] {
  return getActiveProjects()
    .filter(p => p.chains && p.chains.includes(chainId))
    .sort((a, b) => {
      const aSponsored = a.sponsored && (!a.sponsoredUntil || new Date(a.sponsoredUntil) >= new Date());
      const bSponsored = b.sponsored && (!b.sponsoredUntil || new Date(b.sponsoredUntil) >= new Date());
      if (aSponsored && !bSponsored) return -1;
      if (!aSponsored && bSponsored) return 1;
      return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
    });
}

/** 获取项目所属链的信息列表 */
export function getProjectChains(project: ProjectData): Chain[] {
  if (!project.chains || project.chains.length === 0) return [];
  return project.chains
    .map(id => chains.find(c => c.id === id))
    .filter((c): c is Chain => c !== undefined);
}

/** 获取指定链上的所有代币（赞助代币置顶） */
export function getTokensByChain(chainId: string): Token[] {
  return chainTokens
    .filter(t => t.chainId === chainId)
    .sort((a, b) => {
      // Sponsored tokens first
      const aSponsored = a.sponsored && (!a.sponsoredUntil || new Date(a.sponsoredUntil) >= new Date());
      const bSponsored = b.sponsored && (!b.sponsoredUntil || new Date(b.sponsoredUntil) >= new Date());
      if (aSponsored && !bSponsored) return -1;
      if (!aSponsored && bSponsored) return 1;
      // Then by market cap (descending)
      return (b.marketCap || 0) - (a.marketCap || 0);
    });
}

/** 格式化代币价格 */
export function formatTokenPrice(n: number): string {
  if (n >= 1) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  if (n >= 0.0001) return `$${n.toFixed(6)}`;
  if (n > 0) return `$${n.toFixed(9)}`;
  return '—';
}

/** 格式化市值 */
export function formatMarketCap(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return n > 0 ? `$${n.toLocaleString('en-US')}` : '—';
}
