# CryptoNav 项目记忆

## 项目概述
CryptoNav 是一个面向**国际用户（老外）**的加密币综合导航站，聚合交易所、钱包、行情工具、DeFi、NFT 等全品类资源。网站语言为英文。

## 关键决策
- 技术栈：Astro + Tailwind CSS + JSON 数据 + Cloudflare Pages 部署
- 变现模式：广告位（5种）+ 赞助收录 + 联盟链接 + 项目推荐位
- 数据采集：CoinGecko API + DefiLlama API + GitHub Trending + 社区提交
- 采集策略：自动采集 + 质量评分 + 人工审核（评分≥60自动收录）
- 调度：GitHub Actions 每6小时增量采集，每天全量刷新，每周死链检测
- **涨跌颜色惯例：国际惯例（绿=涨，红=跌）**，不用中国惯例

## 文档产出
- `CryptoNav-产品方案.md` — 完整产品方案（定位/功能/架构/技术/路线图）
- `CryptoNav-数据采集方案.md` — 数据自动采集与录入实现方案

## 长期变现方案（3阶段路线图）

### Phase 1：立即上线（零开发成本）
- 接入加密广告网络（Coinzilla / Bitmedia），CPM $5-15
- 交易所/钱包项目链接改为联盟链接（Binance/OKX/Bybit referral，CPA $50-300）
- projects.json 加 `sponsored` 字段，赞助项目置顶 + "Sponsored" 标签（月费 $50-200/项目）

### Phase 2：1-3 个月后（有流量后）
- 建 Chains 维度：`/chain/[slug]` 页面 + projects.json 加 `chains` 数组字段
- 链页顶部高价值广告位（CPM $10-20）
- 主动 BD 联系热门链上项目卖 banner 位（月费 $200-500/位）
- 每周 Newsletter 赞助（$100-300/期）

### Phase 3：6-12 个月后（品牌建立后）
- 广告主自助投放入口（/advertise 页面）
- 加密支付收款（USDT/USCC，Coinbase Commerce / NOWPayments）
- 广告主数据 dashboard（曝光/点击/转化）
- 链页 Premium 独家 banner（$500-2000/月/链）

### 变现优先级
联盟链接 > 广告网络 CPM > Sponsored 标签 > Chains 页面 > 自助投放

### 行业 CPM 基准（2026）
- CEX: $8-15（高级 $18-35）
- DeFi: $6-12（高级 $15-30）
- 钱包: $5-10（高级 $12-25）
- NFT/GameFi: $3-8（高级 $10-20）

### 关键教训
- 广告位 ≠ 广告收入：从建位到收钱需走完 流量→广告主→付费→数据报告→续费 全链
- 新站 DA=0，SEO 排名需 6-12 月，不能指望链页立即有广告价值
- 加密广告网络可零成本接入、从第一天填充库存，是 Phase 1 首选

## 待确认
- 初始项目数据需录入 50-80 个核心项目
- Chains 维度推迟到 Phase 2 再建（用户已认可分阶段方案）
- Phase 1 三件事待用户确认后开始执行
