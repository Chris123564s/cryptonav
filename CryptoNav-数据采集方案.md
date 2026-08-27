# CryptoNav 数据自动采集与录入方案

> 版本：v1.0 | 日期：2026-08-27

---

## 一、整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    数据采集流水线                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ CoinGecko   │  │ DefiLlama   │  │ GitHub      │     │
│  │ API         │  │ API         │  │ Trending    │     │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘    │
│         │                │                │            │
│         ▼                ▼                ▼            │
│  ┌──────────────────────────────────────────────────┐  │
│  │            数据标准化层 (Normalizer)              │  │
│  │  多源数据 → 统一格式 (ProjectData)                │  │
│  └──────────────────┬───────────────────────────────┘  │
│                     │                                  │
│                     ▼                                  │
│  ┌──────────────────────────────────────────────────┐  │
│  │            数据丰富层 (Enricher)                   │  │
│  │  补全：Logo / 社交链接 / 安全标签 / 链上信息       │  │
│  └──────────────────┬───────────────────────────────┘  │
│                     │                                  │
│                     ▼                                  │
│  ┌──────────────────────────────────────────────────┐  │
│  │           质量评分层 (Quality Scorer)             │  │
│  │  流量排名 / 安全评分 / 社区活跃度 → 综合分         │  │
│  └──────────────────┬───────────────────────────────┘  │
│                     │                                  │
│                     ▼                                  │
│  ┌──────────────────────────────────────────────────┐  │
│  │           待审核队列 (Pending Queue)              │  │
│  │  生成 diff 文件 → 人工/半自动审核                  │  │
│  └──────────────────┬───────────────────────────────┘  │
│                     │                                  │
│              ┌──────┴──────┐                           │
│              ▼             ▼                           │
│      ┌──────────┐   ┌──────────┐                      │
│      │ 自动收录  │   │ 丢弃/标记 │                      │
│      │ (高分)   │   │ (低分待审)│                      │
│      └──────────┘   └──────────┘                      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**核心思路：**
- **多源采集**：同时从 CoinGecko、DefiLlama、GitHub 等公开 API 拉取数据
- **标准化**：不同源的数据格式统一为 `ProjectData` 结构
- **丰富化**：自动补全 Logo、社交链接、安全标签等
- **评分过滤**：根据流量排名、社区活跃度等自动打分，高分自动收录，低分进待审队列
- **人工把关**：所有数据以 diff 形式提交，审核后才合并到正式数据

---

## 二、数据源详解

### 2.1 CoinGecko API（主数据源）

**用途**：交易所、币种、钱包等基础信息

```
GET https://api.coingecko.com/api/v3/coins/markets
    ?vs_currency=usd
    &order=market_cap_desc
    &per_page=100
    &page=1

GET https://api.coingecko.com/api/v3/exchanges
    ?per_page=100
```

**可获取字段：**

```json
// 币种数据
{
  "id": "bitcoin",
  "symbol": "btc",
  "name": "Bitcoin",
  "image": { "thumb": "...", "large": "..." },
  "current_price": 65000,
  "market_cap": 1280000000000,
  "market_cap_rank": 1,
  "price_change_percentage_24h": 2.5,
  "total_volume": 30000000000,
  "homepage": "https://bitcoin.org",
  "categories": ["layer-1"],
  "description": { "en": "...", "zh": "..." }
}

// 交易所数据
{
  "id": "binance",
  "name": "Binance",
  "image": "https://...",
  "year_established": 2017,
  "country": "Cayman Islands",
  "trade_volume_24h_btc": 500000,
  "url": "https://www.binance.com",
  "twitter_handle": "binance",
  "has_trading_incentive": false
}
```

**采集脚本：**

```typescript
// scripts/collectors/coingecko.ts

import type { ProjectData } from '../types';

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

// 拉取交易所列表
export async function fetchExchanges(): Promise<ProjectData[]> {
  const res = await fetch(`${COINGECKO_BASE}/exchanges?per_page=100`);
  const raw = await res.json();
  
  return raw.map((item: any) => ({
    id: item.id,
    name: item.name,
    logo: item.image,
    category: item.centralized ? 'exchange-cex' : 'exchange-dex',
    description: `${item.name} 成立于 ${item.year_established || '未知'} 年，位于 ${item.country || '未知'}`,
    website: item.url,
    social: {
      twitter: item.twitter_handle || null
    },
    metrics: {
      volume24h: item.trade_volume_24h_btc,
      yearEstablished: item.year_established
    },
    source: 'coingecko',
    collectedAt: new Date().toISOString()
  }));
}

// 拉取热门币种（Top 100）
export async function fetchTopCoins(): Promise<ProjectData[]> {
  const res = await fetch(
    `${COINGECKO_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1`
  );
  const raw = await res.json();
  
  return raw.map((item: any) => ({
    id: item.id,
    name: item.name,
    symbol: item.symbol?.toUpperCase(),
    logo: item.image,
    category: 'coin',
    description: null, // 需要单独拉详情
    website: null,    // 需要单独拉详情
    metrics: {
      price: item.current_price,
      marketCap: item.market_cap,
      marketCapRank: item.market_cap_rank,
      volume24h: item.total_volume,
      priceChange24h: item.price_change_percentage_24h
    },
    source: 'coingecko',
    collectedAt: new Date().toISOString()
  }));
}

// 拉取币种详情（补全 website + description）
export async function fetchCoinDetail(coinId: string): Promise<Partial<ProjectData>> {
  const res = await fetch(`${COINGECKO_BASE}/coins/${coinId}`);
  const item = await res.json();
  
  return {
    description: item.description?.zh || item.description?.en || null,
    website: item.links?.homepage?.[0] || null,
    social: {
      twitter: item.links?.twitter_screen_name || null,
      reddit: item.links?.subreddit_url || null,
      github: item.links?.repos_url?.github?.[0] || null,
      telegram: item.links?.telegram_channel_identifier || null
    },
    metrics: {
      communityData: {
        twitterFollowers: item.community_data?.twitter_followers,
        redditSubscribers: item.community_data?.reddit_subscribers,
        githubStars: item.community_data?.github_stars
      }
    }
  };
}
```

### 2.2 DefiLlama API（DeFi 数据源）

**用途**：DeFi 协议、TVL 数据、链信息

```
GET https://api.llama.fi/protocols       # 所有 DeFi 协议
GET https://api.llama.fi/protocol/{name} # 单个协议详情
GET https://api.llama.fi/chains          # 所有链
```

**采集脚本：**

```typescript
// scripts/collectors/defillama.ts

export async function fetchDefiProtocols(): Promise<ProjectData[]> {
  const res = await fetch('https://api.llama.fi/protocols');
  const raw = await res.json();
  
  return raw
    .filter((p: any) => p.tvl > 1000000) // 只收录 TVL > 100万 的
    .map((item: any) => ({
      id: `defi-${item.slug}`,
      name: item.name,
      logo: item.logo,
      category: mapDefiCategory(item.category),
      tags: item.chains,  // 所在链
      description: `${item.name} 是一个 ${item.category} 协议，部署在 ${item.chains.join(', ')}，TVL 约 $${(item.tvl / 1e6).toFixed(1)}M`,
      website: item.url,
      metrics: {
        tvl: item.tvl,
        tvlRank: item.rank,
        chain: item.chains,
        category: item.category,
        change24h: item.change_1h,
        change7d: item.change_7d
      },
      source: 'defillama',
      collectedAt: new Date().toISOString()
    }));
}

function mapDefiCategory(llamaCat: string): string {
  const map: Record<string, string> = {
    'Dexes': 'exchange-dex',
    'Lending': 'defi-lending',
    'Yield': 'defi-yield',
    'Bridge': 'defi-bridge',
    'Derivatives': 'defi-derivatives',
    'Stablecoin': 'defi-stablecoin',
    'Liquid Staking': 'defi-liquid-staking',
    'CDP': 'defi-cdp',
    'Restaking': 'defi-restaking'
  };
  return map[llamaCat] || 'defi-other';
}
```

### 2.3 GitHub Trending（开发工具/公链发现）

**用途**：发现热门加密项目和技术工具

```
GET https://api.github.com/search/repositories
    ?q=crypto+OR+blockchain+OR+defi+language:solidity
    &sort=stars&order=desc&per_page=50
```

```typescript
// scripts/collectors/github.ts

export async function fetchTrendingCryptoRepos(): Promise<ProjectData[]> {
  const res = await fetch(
    'https://api.github.com/search/repositories' +
    '?q=crypto+OR+blockchain+OR+defi+OR=web3&sort=stars&order=desc&per_page=50',
    { headers: { 'Accept': 'application/vnd.github.v3+json' } }
  );
  const { items } = await res.json();
  
  return items.map((repo: any) => ({
    id: `github-${repo.id}`,
    name: repo.name,
    logo: repo.owner.avatar_url,
    category: 'infra-dev-tools',
    description: repo.description,
    website: repo.homepage || repo.html_url,
    social: {
      github: repo.full_name
    },
    metrics: {
      githubStars: repo.stargazers_count,
      githubForks: repo.forks_count,
      lastUpdate: repo.pushed_at,
      openIssues: repo.open_issues_count
    },
    source: 'github',
    collectedAt: new Date().toISOString()
  }));
}
```

### 2.4 社区提交（用户贡献）

**用途**：用户提交项目 → 自动预填 → 人工审核

```typescript
// scripts/collectors/community-submit.ts

export async function processCommunitySubmission(url: string): Promise<ProjectData> {
  // 1. 从提交的 URL 抓取页面 meta 信息
  const html = await fetch(url).then(r => r.text());
  const meta = extractMetaTags(html);
  
  // 2. 尝试匹配已知 API 数据源
  const matched = await matchToDataSource(url);
  
  return {
    id: `community-${Date.now()}`,
    name: meta.title || matched?.name,
    logo: meta.ogImage || matched?.logo,
    website: url,
    description: meta.description || matched?.description,
    social: await fetchSocialLinks(url),
    source: 'community',
    submittedAt: new Date().toISOString(),
    status: 'pending-review',
    // 附带自动补充的数据
    autoEnriched: matched
  };
}

function extractMetaTags(html: string) {
  const getMeta = (name: string) => {
    const match = html.match(new RegExp(`<meta[^>]*(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i'));
    return match?.[1] || null;
  };
  return {
    title: getMeta('og:title'),
    description: getMeta('og:description'),
    ogImage: getMeta('og:image')
  };
}
```

---

## 三、数据标准化与丰富化

### 3.1 统一数据结构

```typescript
// src/types/index.ts

export interface ProjectData {
  // 基础信息
  id: string;                    // 唯一 ID
  name: string;
  symbol?: string;
  logo: string;                  // Logo URL
  category: string;              // 分类 ID
  subcategory?: string;
  tags?: string[];
  description: string;
  website: string;
  
  // 社交链接
  social: {
    twitter?: string;
    telegram?: string;
    discord?: string;
    github?: string;
    reddit?: string;
  };
  
  // 量化指标
  metrics?: {
    // 市场数据
    price?: number;
    marketCap?: number;
    marketCapRank?: number;
    volume24h?: number;
    priceChange24h?: number;
    
    // DeFi 数据
    tvl?: number;
    tvlRank?: number;
    chain?: string[];
    
    // 社区数据
    twitterFollowers?: number;
    githubStars?: number;
    redditSubscribers?: number;
    telegramMembers?: number;
    
    // 安全数据
    audited?: boolean;
    auditReports?: string[];
  };
  
  // 安全标签
  verified?: boolean;            // 团队已验证
  audited?: boolean;             // 已审计
  riskLevel?: 'low' | 'medium' | 'high';
  warnings?: string[];           // 风险提示
  
  // 展示控制
  featured?: boolean;            // 精选推荐
  sponsored?: boolean;           // 赞助项目
  sponsoredUntil?: string;       // 赞助到期时间
  
  // 管理
  status: 'active' | 'pending-review' | 'inactive' | 'delisted';
  source: 'coingecko' | 'defillama' | 'github' | 'community' | 'manual';
  collectedAt: string;
  addedAt?: string;
  updatedAt?: string;
  
  // 去重用
  aliases?: string[];            // 其他可能名称
  websiteHashes?: string[];      // 网站的多种 URL 变体
}
```

### 3.2 数据丰富化（Enricher）

```typescript
// scripts/enricher.ts

import type { ProjectData } from '../src/types';
import { fetchCoinDetail } from './collectors/coingecko';

/**
 * 数据丰富化：对采集到的原始数据进行补全和增强
 */
export async function enrichProject(project: ProjectData): Promise<ProjectData> {
  const enriched = { ...project };
  
  // 1. 如果来源是 CoinGecko，拉取详情补全 description 和 social links
  if (project.source === 'coingecko' && project.category === 'coin') {
    const detail = await fetchCoinDetail(project.id);
    Object.assign(enriched, detail);
  }
  
  // 2. 从官网抓取 social links
  if (project.website && !project.social?.twitter) {
    const socials = await scrapeSocialLinks(project.website);
    enriched.social = { ...enriched.social, ...socials };
  }
  
  // 3. Logo 下载到本地（避免外链失效）
  if (project.logo && project.logo.startsWith('http')) {
    const localPath = await downloadLogo(project.id, project.logo);
    enriched.logo = localPath;
  }
  
  // 4. 自动分类（如果缺少分类）
  if (!project.category || project.category === 'unknown') {
    enriched.category = autoClassify(project);
  }
  
  // 5. 自动标签生成
  if (!project.tags || project.tags.length === 0) {
    enriched.tags = autoTag(project);
  }
  
  return enriched;
}

/** 从网页抓取社交链接 */
async function scrapeSocialLinks(url: string): Promise<Partial<ProjectData['social']>> {
  try {
    const html = await fetch(url, { 
      signal: AbortSignal.timeout(10000) 
    }).then(r => r.text());
    
    const extract = (pattern: string) => {
      const match = html.match(new RegExp(pattern, 'i'));
      return match?.[1] || null;
    };
    
    return {
      twitter: extract('https?://(?:www\\.)?twitter\\.com/([\\w]+)'),
      telegram: extract('https?://t\\.me/([\\w]+)'),
      discord: extract('https?://(?:www\\.)?discord\\.(?:gg|com/invite)/([\\w]+)'),
      github: extract('https?://github\\.com/([\\w-]+/[\\w-]+)'),
      reddit: extract('https?://(?:www\\.)?reddit\\.com/r/([\\w]+)')
    };
  } catch {
    return {};
  }
}

/** Logo 下载到本地 */
async function downloadLogo(id: string, logoUrl: string): Promise<string> {
  const res = await fetch(logoUrl);
  const buffer = await res.arrayBuffer();
  const ext = logoUrl.match(/\.(png|jpg|svg|webp)$/i)?.[0] || '.png';
  const localPath = `/logos/${id}${ext}`;
  const fs = await import('fs/promises');
  await fs.mkdir('./public/logos', { recursive: true });
  await fs.writeFile(`./public${localPath}`, Buffer.from(buffer));
  return localPath;
}

/** 自动分类 */
function autoClassify(project: ProjectData): string {
  const text = `${project.name} ${project.description || ''}`.toLowerCase();
  const rules: Array<[string[], string]> = [
    [['exchange', '交易', 'swap'], 'exchange-dex'],
    [['wallet', '钱包'], 'wallet-hot'],
    [['lending', 'borrow', '借贷'], 'defi-lending'],
    [['bridge', 'cross-chain', '跨链'], 'defi-bridge'],
    [['nft', 'marketplace'], 'nft-marketplace'],
    [['explorer', '区块浏览器'], 'tool-explorer'],
    [['audit', 'security', '审计'], 'security-audit'],
    [['hardware', '硬件'], 'wallet-cold'],
  ];
  for (const [keywords, category] of rules) {
    if (keywords.some(k => text.includes(k))) return category;
  }
  return 'other';
}

/** 自动打标签 */
function autoTag(project: ProjectData): string[] {
  const tags: string[] = [];
  if (project.metrics?.marketCapRank && project.metrics.marketCapRank <= 10) tags.push('头部');
  if (project.metrics?.tvl && project.metrics.tvl > 100e6) tags.push('大TVL');
  if (project.metrics?.githubStars && project.metrics.githubStars > 1000) tags.push('热门开源');
  if (project.metrics?.audited) tags.push('已审计');
  return tags;
}
```

---

## 四、质量评分与自动收录

### 4.1 评分模型

```typescript
// scripts/quality-scorer.ts

import type { ProjectData } from '../src/types';

interface ScoreResult {
  total: number;          // 0-100
  autoAccept: boolean;    // 是否自动收录
  reasons: string[];      // 评分依据
}

export function scoreProject(project: ProjectData): ScoreResult {
  let score = 0;
  const reasons: string[] = [];
  
  // 1. 市场数据分 (最高 30 分)
  if (project.metrics?.marketCapRank) {
    const rank = project.metrics.marketCapRank;
    if (rank <= 10) { score += 30; reasons.push(`市值排名 #${rank} (+30)`); }
    else if (rank <= 50) { score += 20; reasons.push(`市值排名 #${rank} (+20)`); }
    else if (rank <= 100) { score += 10; reasons.push(`市值排名 #${rank} (+10)`); }
    else if (rank <= 200) { score += 5; reasons.push(`市值排名 #${rank} (+5)`); }
  }
  
  // 2. TVL 分 (最高 25 分，DeFi 类适用)
  if (project.metrics?.tvl) {
    const tvl = project.metrics.tvl;
    if (tvl > 1e9) { score += 25; reasons.push(`TVL $${(tvl/1e9).toFixed(1)}B (+25)`); }
    else if (tvl > 1e8) { score += 18; reasons.push(`TVL $${(tvl/1e6).toFixed(0)}M (+18)`); }
    else if (tvl > 1e7) { score += 10; reasons.push(`TVL $${(tvl/1e6).toFixed(0)}M (+10)`); }
    else if (tvl > 1e6) { score += 5; reasons.push(`TVL $${(tvl/1e6).toFixed(0)}M (+5)`); }
  }
  
  // 3. 社区活跃度分 (最高 20 分)
  let communityScore = 0;
  if (project.metrics?.twitterFollowers) {
    const followers = project.metrics.twitterFollowers;
    if (followers > 1e6) communityScore = Math.max(communityScore, 15);
    else if (followers > 1e5) communityScore = Math.max(communityScore, 10);
    else if (followers > 1e4) communityScore = Math.max(communityScore, 5);
    reasons.push(`Twitter ${followers} 粉丝 (+${communityScore})`);
  }
  if (project.metrics?.githubStars && project.metrics.githubStars > 1000) {
    communityScore += 5;
    reasons.push(`GitHub ${project.metrics.githubStars} stars (+5)`);
  }
  score += Math.min(communityScore, 20);
  
  // 4. 安全分 (最高 15 分)
  if (project.audited) { score += 10; reasons.push('已审计 (+10)'); }
  if (project.verified) { score += 5; reasons.push('团队已验证 (+5)'); }
  
  // 5. 数据完整度 (最高 10 分)
  if (project.description) score += 2;
  if (project.logo) score += 2;
  if (project.social?.twitter) score += 2;
  if (project.website) score += 2;
  if (project.metrics) score += 2;
  reasons.push(`数据完整度 (+${2+2+2+2+2})`);
  
  // 6. 减分项
  if (project.riskLevel === 'high') { score -= 20; reasons.push('高风险 (-20)'); }
  if (project.warnings?.length) { score -= 5; reasons.push('有风险提示 (-5)'); }
  
  score = Math.max(0, Math.min(100, score));
  
  return {
    total: score,
    autoAccept: score >= 60 && project.riskLevel !== 'high',
    reasons
  };
}
```

### 4.2 收录决策

```typescript
// scripts/pipeline.ts

import { fetchExchanges, fetchTopCoins } from './collectors/coingecko';
import { fetchDefiProtocols } from './collectors/defillama';
import { fetchTrendingCryptoRepos } from './collectors/github';
import { enrichProject } from './enricher';
import { scoreProject } from './quality-scorer';
import type { ProjectData } from '../src/types';

export async function runPipeline() {
  console.log('=== CryptoNav 数据采集流水线启动 ===\n');
  
  // 1. 多源采集
  console.log('[1/5] 采集数据...');
  const [exchanges, coins, defiProtocols, githubRepos] = await Promise.all([
    fetchExchanges().catch(() => []),
    fetchTopCoins().catch(() => []),
    fetchDefiProtocols().catch(() => []),
    fetchTrendingCryptoRepos().catch(() => [])
  ]);
  
  const collected = [...exchanges, ...coins, ...defiProtocols, ...githubRepos];
  console.log(`  采集到 ${collected.length} 条原始数据`);
  
  // 2. 去重
  console.log('[2/5] 去重...');
  const deduped = deduplicate(collected);
  console.log(`  去重后 ${deduped.length} 条`);
  
  // 3. 丰富化
  console.log('[3/5] 数据丰富化...');
  const enriched: ProjectData[] = [];
  for (const project of deduped) {
    try {
      const enrichedProject = await enrichProject(project);
      enriched.push(enrichedProject);
    } catch (e) {
      console.error(`  丰富化失败: ${project.name}`, e);
    }
  }
  
  // 4. 评分
  console.log('[4/5] 质量评分...');
  const scored = enriched.map(p => ({ project: p, score: scoreProject(p) }));
  const autoAccepted = scored.filter(s => s.score.autoAccept);
  const needsReview = scored.filter(s => !s.score.autoAccept);
  console.log(`  自动收录: ${autoAccepted.length} 条 (评分≥60)`);
  console.log(`  待审核: ${needsReview.length} 条`);
  
  // 5. 生成待审 diff
  console.log('[5/5] 生成待审文件...');
  const existing = await loadExistingProjects();
  
  const newProjects = autoAccepted
    .filter(s => !existing.find(e => e.id === s.project.id))
    .map(s => ({ ...s.project, status: 'active', addedAt: new Date().toISOString() }));
  
  const reviewQueue = needsReview.map(s => ({ 
    ...s.project, 
    status: 'pending-review',
    score: s.score.total,
    scoreReasons: s.score.reasons
  }));
  
  // 写入文件
  await savePendingReview(reviewQueue, './data/pending-review.json');
  await mergeNewProjects(newProjects, './data/projects.json');
  
  // 生成审核报告
  await generateReviewReport({
    collected: collected.length,
    deduped: deduped.length,
    enriched: enriched.length,
    autoAccepted: autoAccepted.length,
    needsReview: needsReview.length,
    newAdditions: newProjects.length
  });
  
  console.log('\n=== 流水线完成 ===');
  console.log(`新收录: ${newProjects.length} | 待审核: ${reviewQueue.length}`);
}

/** 去重逻辑：按 website + name 匹配 */
function deduplicate(projects: ProjectData[]): ProjectData[] {
  const seen = new Map<string, ProjectData>();
  for (const p of projects) {
    const key = (p.website || '').toLowerCase().replace(/\/$/, '') || p.name.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, p);
    } else {
      // 合并数据：优先保留信息更丰富的版本
      const existing = seen.get(key)!;
      const merged = mergeProjects(existing, p);
      seen.set(key, merged);
    }
  }
  return Array.from(seen.values());
}

function mergeProjects(a: ProjectData, b: ProjectData): ProjectData {
  return {
    ...a,
    ...b,
    metrics: { ...a.metrics, ...b.metrics },
    social: { ...a.social, ...b.social },
    tags: [...new Set([...(a.tags || []), ...(b.tags || [])])],
    // 保留更早的采集时间
    collectedAt: a.collectedAt < b.collectedAt ? a.collectedAt : b.collectedAt
  };
}
```

---

## 五、调度与自动化

### 5.1 GitHub Actions 定时调度

```yaml
# .github/workflows/data-pipeline.yml

name: CryptoNav Data Pipeline

on:
  schedule:
    # 每 6 小时跑一次增量采集
    - cron: '0 */6 * * *'
    # 每天凌晨 3 点全量刷新
    - cron: '0 3 * * *'
  workflow_dispatch: {}  # 手动触发

jobs:
  collect:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      
      - name: Install deps
        run: npm ci
      
      - name: Run data pipeline
        run: npx tsx scripts/pipeline.ts
        env:
          COINGECKO_API_KEY: ${{ secrets.COINGECKO_API_KEY }}
      
      - name: Check for changes
        id: changes
        run: |
          git diff --exit-code data/projects.json && echo "changed=false" >> $GITHUB_OUTPUT || echo "changed=true" >> $GITHUB_OUTPUT
      
      - name: Create Pull Request (if new data)
        if: steps.changes.outputs.changed == 'true'
        uses: peter-evans/create-pull-request@v6
        with:
          title: 'data: auto-collect update'
          body: |
            自动采集数据更新
            
            - 新收录项目请审核 `data/pending-review.json`
            - 已自动收录高质量项目
            
            Generated by GitHub Actions
          branch: data/auto-collect
          commit-message: 'data: auto-collect pipeline update'

  dead-link-check:
    runs-on: ubuntu-latest
    schedule:
      - cron: '0 6 * * 1'  # 每周一早上 6 点
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - name: Check dead links
        run: npx tsx scripts/check-dead-links.ts
```

### 5.2 死链检测脚本

```typescript
// scripts/check-dead-links.ts

import { readProjects } from '../src/utils/data';
import type { ProjectData } from '../src/types';

const TIMEOUT = 10000;  // 10 秒超时

async function checkUrl(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow'
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    // HEAD 不支持时降级为 GET
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT);
      const res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'follow'
      });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }
}

async function main() {
  const projects = await readProjects();
  const results: Array<{ id: string; name: string; url: string; status: string }> = [];
  
  console.log(`检测 ${projects.length} 个项目链接...\n`);
  
  // 并发检测，限制 10 并发
  const BATCH_SIZE = 10;
  for (let i = 0; i < projects.length; i += BATCH_SIZE) {
    const batch = projects.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (p) => {
        const alive = await checkUrl(p.website);
        return {
          id: p.id,
          name: p.name,
          url: p.website,
          status: alive ? 'alive' : 'dead'
        };
      })
    );
    results.push(...batchResults);
    process.stdout.write(`\r进度: ${Math.min(i + BATCH_SIZE, projects.length)}/${projects.length}`);
  }
  
  const dead = results.filter(r => r.status === 'dead');
  console.log(`\n\n检测完成: ${results.length} 总计, ${dead.length} 个死链`);
  
  if (dead.length > 0) {
    console.log('\n死链列表:');
    dead.forEach(d => console.log(`  ✗ ${d.name} - ${d.url}`));
    
    // 写入死链报告
    const fs = await import('fs/promises');
    await fs.writeFile(
      './data/dead-links-report.json',
      JSON.stringify(dead, null, 2)
    );
    
    // 更新项目状态
    const updated = projects.map(p => {
      const result = results.find(r => r.id === p.id);
      if (result?.status === 'dead') {
        return { ...p, status: 'inactive', warnings: [...(p.warnings || []), '链接不可访问'] };
      }
      return p;
    });
    await fs.writeFile(
      './data/projects.json',
      JSON.stringify(updated, null, 2)
    );
  }
}

main();
```

---

## 六、审核工作流

### 6.1 审核流程

```
自动采集 → 评分 → ┌─ 高分(≥60) → 自动收录 → 生成 PR → 人工合并
                   │
                   └─ 低分(<60) → 待审队列 → 审核界面 → 人工决策
                                                              │
                                                    ┌─────────┴─────────┐
                                                    │                   │
                                                 收录                丢弃/标记风险
```

### 6.2 待审核数据格式

```json
// data/pending-review.json
[
  {
    "id": "some-new-project",
    "name": "NewProject",
    "logo": "/logos/new-project.png",
    "category": "unknown",
    "description": "A new DeFi protocol...",
    "website": "https://newproject.io",
    "social": {
      "twitter": "newproject",
      "telegram": "newproject_chat"
    },
    "metrics": {
      "tvl": 5000000,
      "twitterFollowers": 8000
    },
    "source": "defillama",
    "score": 35,
    "scoreReasons": [
      "TVL $5M (+5)",
      "Twitter 8000 粉丝 (+0)",
      "数据完整度 (+8)"
    ],
    "status": "pending-review",
    "collectedAt": "2026-08-27T10:00:00Z"
  }
]
```

### 6.3 审核操作（手动审核）

审核人员查看 `pending-review.json`，对每个项目做决策：

```bash
# 审核命令行工具
npx tsx scripts/review.ts approve <projectId> --category "exchange-dex" --tags "热门,DEX"
npx tsx scripts/review.ts reject <projectId> --reason "疑似诈骗，无审计报告"
npx tsx scripts/review.ts flag <projectId> --warning "高收益承诺，投资需谨慎"
```

```typescript
// scripts/review.ts

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const PENDING_PATH = resolve('data/pending-review.json');
const PROJECTS_PATH = resolve('data/projects.json');

function approve(projectId: string, category: string, tags: string) {
  const pending = JSON.parse(readFileSync(PENDING_PATH, 'utf-8'));
  const projects = JSON.parse(readFileSync(PROJECTS_PATH, 'utf-8'));
  
  const project = pending.find((p: any) => p.id === projectId);
  if (!project) {
    console.error(`项目 ${projectId} 不在待审队列中`);
    process.exit(1);
  }
  
  // 设置分类和标签
  project.category = category;
  project.tags = tags.split(',');
  project.status = 'active';
  project.addedAt = new Date().toISOString();
  delete project.score;
  delete project.scoreReasons;
  
  // 从待审移到正式
  projects.push(project);
  const newPending = pending.filter((p: any) => p.id !== projectId);
  
  writeFileSync(PROJECTS_PATH, JSON.stringify(projects, null, 2));
  writeFileSync(PENDING_PATH, JSON.stringify(newPending, null, 2));
  
  console.log(`✓ 已收录: ${project.name}`);
}

// CLI 入口
const [cmd, projectId, ...rest] = process.argv.slice(2);
if (cmd === 'approve') {
  const categoryFlag = rest.find(a => a.startsWith('--category'));
  const tagsFlag = rest.find(a => a.startsWith('--tags'));
  approve(
    projectId,
    categoryFlag?.split('=')[1] || rest[0] || 'other',
    tagsFlag?.split('=')[1] || rest[1] || ''
  );
}
```

---

## 七、增量更新机制

### 7.1 数据版本管理

```typescript
// scripts/sync.ts

/** 增量更新：只更新已有项目的 metrics，不改变分类/标签等人工编辑的字段 */
export async function syncExistingProjects() {
  const existing = JSON.parse(readFileSync('data/projects.json', 'utf-8'));
  
  // 重新采集最新数据
  const [exchanges, coins, defiProtocols] = await Promise.all([
    fetchExchanges(),
    fetchTopCoins(),
    fetchDefiProtocols()
  ]);
  
  const freshData = deduplicate([...exchanges, ...coins, ...defiProtocols]);
  
  // 只更新 metrics 字段，保留人工编辑的字段
  const updated = existing.map((existing: ProjectData) => {
    const fresh = freshData.find(f => 
      f.id === existing.id ||
      f.website === existing.website ||
      existing.aliases?.includes(f.name)
    );
    
    if (!fresh) return existing;
    
    return {
      ...existing,  // 保留所有人工编辑
      metrics: {   // 只更新指标
        ...existing.metrics,
        ...fresh.metrics
      },
      updatedAt: new Date().toISOString()
    };
  });
  
  writeFileSync('data/projects.json', JSON.stringify(updated, null, 2));
  console.log(`已同步 ${updated.length} 个项目的最新数据`);
}
```

### 7.2 保护人工编辑

```typescript
// 手动编辑的字段，同步时不会被覆盖
const PROTECTED_FIELDS = [
  'category',       // 人工分类
  'tags',           // 人工标签
  'description',    // 人工描述（可能比自动采集的更好）
  'featured',       // 精选标记
  'sponsored',      // 赞助标记
  'verified',       // 验证标记
  'audited',        // 审计标记
  'riskLevel',      // 风险等级
  'warnings'         // 风险提示
];

export function smartMerge(existing: ProjectData, fresh: Partial<ProjectData>): ProjectData {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(fresh)) {
    if (PROTECTED_FIELDS.includes(key)) continue;  // 保护人工编辑
    if (key === 'metrics') {
      merged.metrics = { ...existing.metrics, ...value };
    } else {
      (merged as any)[key] = value;
    }
  }
  return merged;
}
```

---

## 八、API 限流与容错

### 8.1 请求频率控制

```typescript
// scripts/utils/rate-limiter.ts

export class RateLimiter {
  private queue: Array<() => void> = [];
  private running = 0;
  
  constructor(
    private maxConcurrent: number = 5,    // 最大并发
    private minInterval: number = 1200     // CoinGecko 免费版：~50次/分钟 ≈ 1.2秒/次
  ) {}
  
  async run<T>(fn: () => Promise<T>): Promise<T> {
    // 等待并发槽位
    while (this.running >= this.maxConcurrent) {
      await new Promise(resolve => this.queue.push(resolve));
    }
    
    this.running++;
    
    try {
      // 间隔控制
      const lastCall = this.lastCallTime;
      const elapsed = Date.now() - lastCall;
      if (elapsed < this.minInterval) {
        await new Promise(r => setTimeout(r, this.minInterval - elapsed));
      }
      this.lastCallTime = Date.now();
      
      return await fn();
    } finally {
      this.running--;
      if (this.queue.length > 0) {
        const next = this.queue.shift()!;
        next();
      }
    }
  }
  
  private lastCallTime = 0;
}
```

### 8.2 重试与降级

```typescript
// scripts/utils/fetch-with-retry.ts

export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  maxRetries = 3
): Promise<Response> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(15000)
      });
      
      if (res.status === 429) {
        // 限流，等待后重试
        const wait = Math.min(1000 * Math.pow(2, attempt), 30000);
        console.log(`  限流，${wait/1000}s 后重试 (attempt ${attempt}/${maxRetries})`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      
      if (res.ok || res.status === 404) return res;
      
      throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (attempt === maxRetries) throw e;
      const wait = 1000 * attempt;
      console.log(`  请求失败，${wait/1000}s 后重试 (attempt ${attempt}/${maxRetries})`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw new Error('Max retries exceeded');
}
```

---

## 九、数据流总结

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ CoinGecko│    │DefiLlama │    │ GitHub   │    │ 社区提交  │
│  API     │    │  API     │    │  API     │    │  (表单)  │
└────┬─────┘    └────┬─────┘    └────┬─────┘    └────┬─────┘
     │               │               │               │
     └───────────────┴───────────────┴───────────────┘
                           │
                    ┌──────▼──────┐
                    │  标准化层    │  → 统一 ProjectData 格式
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  去重层      │  → 按 website + name 合并
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  丰富化层    │  → 补全 Logo / 社交 / 安全标签
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  评分层      │  → 0-100 分，自动决策
                    └──┬──────┬───┘
                       │      │
                  ┌────▼┐  ┌─▼──────────┐
                  │自动 │  │待审队列      │
                  │收录 │  │pending.json │
                  └──┬──┘  └──────┬─────┘
                     │            │
                     ▼            ▼
              ┌──────────┐  ┌──────────┐
              │projects  │  │ 人工审核   │
              │.json     │  │ → 收录/丢弃│
              └──────────┘  └────┬─────┘
                                   │
                              ┌────▼─────┐
                              │projects  │
                              │.json     │
                              └──────────┘
                                   │
                          ┌────────▼────────┐
                          │  GitHub Actions  │
                          │  每 6 小时增量    │
                          │  每天 3 点全量    │
                          │  每周死链检测     │
                          └─────────────────┘
```

---

## 十、实施优先级

| 优先级 | 模块 | 说明 |
|--------|------|------|
| P0 | CoinGecko 采集器 | 主数据源，先跑通 |
| P0 | 数据标准化 + 去重 | 统一格式 |
| P0 | 评分器 | 自动决策收录 |
| P1 | DefiLlama 采集器 | 补全 DeFi 数据 |
| P1 | 丰富化层 | Logo 下载 + 社交链接补全 |
| P1 | GitHub Actions 调度 | 自动化 |
| P2 | 死链检测 | 定期维护 |
| P2 | 社区提交处理 | 用户贡献入口 |
| P2 | 增量同步 | 保护人工编辑 |
| P3 | 审核命令行工具 | 人工审核提效 |
| P3 | GitHub Trending 采集器 | 发现新项目 |

---

_本方案为 v1.0，采集脚本可按 P0-P3 优先级逐步实现。_
