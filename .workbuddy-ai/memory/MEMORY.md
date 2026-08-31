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

## 实时行情数据架构（重要）

浏览器端行情组件（MarketChart / TickerBar / CurrentPicks / NewTokensRadar / dashboard）
统一走 `src/utils/coingecko.ts` 的 `cgFetch()`，双路取数：

1. **优先** `/api/cg/*` —— Cloudflare Pages Function（`functions/api/cg/[[path]].js`），
   边缘缓存 + 并发去重 + 24h 陈旧兜底。一次上游请求服务所有访客。
2. **回退** 访客自己的 IP 直连 CoinGecko —— 当边缘返回 429/5xx 时触发；
   一旦边缘失败，本页生命周期内不再重试边缘。

**为什么需要回退（线上实测结论）**：CoinGecko 免费档按 IP 限流，而 Cloudflare 数据中心
出口 IP 被海量 Worker 共用，长期被限流。实测同一时刻：边缘连续 5 次 429， residential IP
直连连续 3 次 200。无 key 时边缘缓存永远填不满 → 代理 100% 无用。

**彻底解法**：注册 CoinGecko 免费 Demo key，在 Cloudflare Pages 配环境变量
`COINGECKO_API_KEY`（Pro 用 `COINGECKO_PRO_API_KEY`）。限流从「按 IP」变「按 key」，
边缘缓存才真正生效。代码已支持，配好 key 无需改任何代码。

回归测试：`npm run test:cg`（`scripts/test-cg-proxy.mjs`，21 条断言，mock Cache API + mock 上游）。

## 部署架构（2026-08-31 修复后，重要）

### 根因与现状
- `public/_routes.json` 缺 `"exclude": []` 导致**所有**部署在发布阶段被拒一整天。
  云文档说 exclude 可选，Wrangler 源码（`isRoutesJSONSpec()`）要求 include 和 exclude
  必须都是数组。Pages 自带构建器只报 `Failed to publish assets`，Wrangler 会直说
  `Invalid _routes.json`。已修复并加 `scripts/check-routes-json.mjs` 常驻校验
  （规则抄自 Wrangler 4.127.1 源码，**注释里写明了为什么不能照文档"简化"**）。
- `_routes.json` 是 `5c5b60a`（8-31 12:31）引入的，**同一个 bug 同时打挂了 Pages 自带
  Git 集成**。现已双双恢复并实证（见下）。

### ✅ 已决策（2026-08-31）：选 A —— 保留 Wrangler，每次 push 到 main 自动部署
- `deploy-pages.yml` 触发器 = `push: branches: [main]` + `workflow_dispatch`（保留手动，
  也是发布非 main 分支做预览的唯一方式）
- 5 个定时数据刷新 workflow 每天多次 push 到 main，会各自触发一次部署；
  concurrency 组 `wrangler-pages-deploy` + `cancel-in-progress: false` 串行排队
  （不取消进行中的，避免上传中途被砍留下半成品）
- 故意**不加** `paths-ignore`：文档和 `.workbuddy-ai/**` 虽不影响站点，但过滤会新增
  "推了却没部署"的静默失败类型；公开仓库 CI 分钟数免费。规则：push 到 main 就部署。

### ⚠️ 唯一遗留人工步骤（用户尚未执行）
**必须去 Cloudflare 后台断开 Pages Git 集成**，否则每次 push 仍会被构建发布两次：
`Workers & Pages > cryptonav > Settings > Builds & deployments > Disconnect`
断开**不会**删除项目或自定义域名。断完之后每个 push 只构建一次。

### 下次开工清单（详见 2026-08-31.md 收工总结）
1. 断开 Pages Git 集成（上面那条），并确认一次提交只剩 1 个 check run
2. 重新压测 `/api/cg/*` 边缘代理（连测 10+ 次），再决定是否仍需 CoinGecko key
3. 手册剩余变现配置：8 个联盟码、3 个 newsletter 环境变量、Cache Rule、GSC 重新提交
4. 待办任务 #53「airdrops 页适配新数据格式」
5. 未答：`robots.txt` 是否精简到只保留 Cloudflare 托管规则未覆盖的部分

### CI 警告纪律（约定）
**健康的流水线必须是零警告。** 无法判断的检查只能输出普通日志行（`note()`），
不能进 Annotations 面板；`::warning::` 只留给可行动的情况。
典型反例：本站用的是 account 级 dashboard token，`/user/tokens/verify` 返回空的
`permission_groups`，导致"有没有 Pages 权限"的提示每次都响 → 成功部署看起来像坏的。
已用 `scripts/test-cloudflare-token.mjs`（12 用例，断言**精确警告数**）锁死。

### 边缘代理实测（2026-08-31 21:00，单次观测，非趋势）
`/api/cg/simple/price?ids=bitcoin&vs_currencies=usd` → `{"bitcoin":{"usd":77867}}`，
边缘返回 200。与上方"无 key 时代理 100% 无用"的旧结论不一致，需要重新压测确认
是限流放宽还是缓存命中，再决定是否仍需 CoinGecko key。
`/api/cg/ping` 返回 403 是 CoinGecko 免费档自身限流，代码未使用该端点。

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

## 流量突破点分析（2026-08-28）

### 核心问题诊断
- 网站目前 63 个项目，页面 27 个，DA=0，无自然流量
- CoinGecko/CoinMarketCap/DefiLlama 已占据价格查询和 DeFi 数据赛道
- 作为"导航站"纯目录价值有限，用户去 Google 搜 "best crypto exchange" 更方便

### 5 大突破方向

**1. SEO 长尾词矩阵（低KD高转化）**
- "Binance vs Coinbase"（KD=1，月搜 3400）— 做交易所对比页
- "Ledger vs Trezor"（KD=3，月搜 500）— 做钱包对比页
- "best crypto exchange"（KD=82，月搜 7500）— 做 Top 10 列表页
- "best crypto wallet for beginners"（月搜 500）
- "crypto exchange with lowest fees"（月搜 700）
- 每个对比/评测页都带联盟链接，直接变现

**2. 每日必看内容（提高留存/日活）**
- 现有 Success Cases（DexScreener 涨幅榜）已有雏形
- 可加：Fear & Greed Index、BTC 主导率、Gas 费实时监控
- 每日市场简报（自动化：价格变动 + 大事件 + 链上异常）
- 加密日历（代币解锁、主网升级、IDO 等）

**3. 链页 SEO（已建好基础）**
- /chain/ethereum /chain/solana 等页面已上线
- 目标关键词："ethereum tokens" "solana meme coins" "arbitrum defi projects"
- 需要把 CoinGecko API 自动采集的真实代币数据做上去（已建脚本，等 Actions 运行）
- 每链页可扩展为该链的"一站式信息中心"

**4. 对比/评测内容（高转化低难度）**
- "Binance vs Coinbase" KD=1 — 黄金机会
- "Uniswap vs PancakeSwap" — DEX 对比
- "MetaMask vs Trust Wallet" — 钱包对比
- "Best DeFi platforms 2026" — 综合评测
- 这类内容 SEO 难度低 + 联盟转化率高

**5. 工具化（提高粘性）**
- 现有：MarketChart（K线）、TickerBar（行情条）、NewTokensRadar（新币雷达）
- 可加：Gas 费追踪器、空投日历、代币解锁日历
- 工具类页面用户停留时间长、回访频率高

## 5大突破方向实现状态（2026-08-28 全部完成）

### ✅ 方向1：对比评测页 (compare/)
- 5 篇对比页 + 索引页，共 6 个页面
- Binance vs Coinbase / Ledger vs Trezor / Uniswap vs PancakeSwap / MetaMask vs Trust Wallet / Best Crypto Exchanges 2026
- 每页含优缺点、评分、费用表、联盟链接

### ✅ 方向2：每日市场仪表盘 (dashboard.astro)
- Fear & Greed Index + BTC Dominance + ETH Gas Tracker + Top Gainers/Losers + Trending Searches
- 客户端实时 API 调用，1-5 分钟自动刷新

### ✅ 方向3：链页 SEO（已实现于前阶段）
- /chain/[slug] 页面展示真实代币（CoinGecko API 自动采集）
- GitHub Actions 每 6 小时刷新

### ✅ 方向4：空投 + 解锁日历
- /airdrops: 15 个确认/传闻空投
- /unlocks: 15 个代币解锁事件 + 倒计时

### ✅ 方向5：SEO 教育指南 (learn/)
- 8 篇教育文章 + 索引页，共 9 个页面
- 关键词合计月搜索量 30,000+
- What is staking / stablecoin / DeFi / Web3 / How to read charts / L2 / BTC vs ETH / Market cap

### 当前页面总数：45 页（原 27 + 新增 18）
### Header 导航：Categories / Chains / Dashboard / Compare / Airdrops / Unlocks / Learn / Submit / Advertise
