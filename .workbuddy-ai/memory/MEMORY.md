# CryptoNav 项目记忆

## 项目概述
面向**国际用户**的英文加密币综合导航站（交易所/钱包/行情/DeFi/NFT）。
Astro + Tailwind + JSON 数据 + Cloudflare Pages；仓库 `Chris123564s/cryptonav`（main）。
涨跌颜色用**国际惯例（绿涨红跌）**。

## 联系邮箱（2026-09-02 查证）
- 全站唯一对外邮箱 **`contact@cryptonav.site`**，已接入腾讯企业邮（MX = mxbiz1/2.qq.com）。
  例外：`SubscribeForm.astro` 的 `placeholder="you@example.com"` **故意保留**（改成站长邮箱 = 预填怪 UI）。
- ⚠️ **该域开了 catch-all**：不存在地址也返回 `250 Ok` → **SMTP RCPT 探测完全不可信**。
- ⚠️ **缺 SPF/DMARC**：用 contact@ 外发会进垃圾箱。待用户在 CF 后台手动加
  `v=spf1 include:spf.mail.qq.com ~all`（现有 token 无 DNS 权限，只能后台加）。
- **验证线上邮箱必须解码，不能 grep**：CF Email Obfuscation 把邮箱加密成
  `/cdn-cgi/l/email-protection#<hex>`，HTML 无明文，grep 新旧地址都返回 0 →
  极易误判"部署没生效"。解码器：`scripts/check-cf-email.py`（可 `--expect`，exit 0/1 可挂 CI）。

## 联盟码写入原则（2026-09-02 定，09-04 修正）
- **唯一要守的边界：访客只接触官方域名。** 码的来源不影响访客安全。
- ✅ **可写**：用户给什么链接，就把 `template` 的**域名换成那个链接的域名**，`code` 填链接里的 ID。
- ❌ **不写**：来源不明、用户无法确认归属的野鸡域名（`bsmkweb.cc` 等）。
- ⚠️ **"域名必须官方" ≠ "必须是交易所主域"**。曾把 bybit 联盟短链 `partner.bybit.com/b/166214`
  卡在"模板不兼容"上反复验证，被用户 **"不要去参考模板了，以我的为准"** 点破：
  `template` 只是拼接壳子。联盟短链域出自官方后台，与主域同属官方，**照写**。
- 教训：别因"域名不够官方"拦阻用户 —— 剩余风险只涉及返佣归属，应由用户自主决定，**不要家长式拦阻**。
- 现状：binance `GRO_28502_B2R17` ✅、bybit `166214` ✅（均上线）；
  **okx / coinbase / kraken / gate-io / bitget / mexc 6 家待填（用户直接发链接即可）**。

## 广告位机制（易理解错）
- 渲染优先级：`ads.json 直投（active + 时间窗）> ad-network.json 的 html（广告网络 tag）> promo > "Your Ad Here"`。
- ⚠️ **`weight` 是"构建时被选中的概率"，不是展示概率**。Astro 静态生成 → 每个页面构建时
  `Math.random()` 抽一次，构建完固定。要稳定展示某条，就让它成为该 slot 唯一候选。
- **`image` 填不填决定看不看得见文案**：填了只渲染 `<img>`（title/subtitle 进 alt）；
  不填才走渐变+文字。**活动推广必须留空 image。**
- 统计口径：`scripts/check-ad-slots.mjs` 用 `data-ad-id=`（直投）/ `data-promo-project=`（promo）计数。
  ⚠️ 按"官网 URL 出现次数"统计会**被项目卡片链接污染**，不可信。
- **RULE（写进 ad-network.json 的 note 了）**：promo 的 `projectId` **必须是 affiliates.json 的 key**，
  否则 `getReferralUrl()` 无码可拼、只渲染他人官网，**永远不赚钱且页面上看不出区别**。
  校验：`node -e "const a=require('./src/data/affiliates.json').exchanges,n=require('./src/data/ad-network.json').slots;for(const[s,v]of Object.entries(n))console.log(s,v.projectId,v.projectId in a?'ok':'NEVER EARNS')"`

### 广告卡视觉（2026-09-06 重做）
- 渐变**不用 Tailwind 类**，改三个 CSS 变量 `--ad-1 / --ad-2 / --ad-glow` 写在行内 style
  （卡片需要两个端色 + 第三个更亮的高光色，只有 CSS 能一次带全）。配色表在 `AdBanner.astro`。
- 层次：基础渐变 + 两个模糊光斑 + 网格纹理（mask 渐隐）+ 内描边 + 暗角。
  宽 banner 在 md+ 左右分栏（文案左/CTA 右），sidebar 与 inline 居中堆叠。
- **描述在 <640px 隐藏**：120px 高装不下「换行标题+描述+按钮」，`overflow-hidden` 会拦腰截断。
- **直投与 promo 已合并为一条渲染路径**（原本两段几乎重复的代码，正是"CTA 只有 promo 有"的原因）。
- **改 `.ad-container` / `.ad-label` 必须用更高特异性覆盖**：它们在 `@layer components` ——
  那是 **Tailwind 的处理层，不是原生 cascade layer**，覆盖**不能靠加载顺序**。
  示例：`.ad-label.ad-label--on-media`（Astro 编译后 `.ad-label[data-astro-cid-x].ad-label--on-media`，
  0,3,0）＞ 全局 `.ad-label`（0,1,0）。
- **同一页出现的槽位不要用同一个 gradient**：首页曾有 bybit/binance/okx 三个都是 `exchange`（金），
  两个侧栏上下相邻像同一条广告重复。现 橙/金/靛蓝/蓝。

### 两个「渲染正常但看着像没卖出去」的 bug（2026-09-05 修，易复发）
1. **渐变卡缺 `w-full`**：容器是 `flex items-center justify-center`，子项只写 `h-full`
   → 宽度按文字撑开，两侧露灰底，**看着像空位**。有图分支是 `img.w-full`，所以只有无图的
   渐变卡中招 —— 而活动推广恰恰必须无图。
2. **`border-dashed` 曾写死在 `.ad-container` 基础类**：所有广告（含真素材）都套虚线，
   同时让组件里 `ad.image?'':'border-dashed'` 彻底失效（基础类先加上了）。
   已移除，**虚线现在只留给 "Your Ad Here" 占位**。
- 顺带：`AdConfig.image` 改可选（ad-006 从无此字段却在断言必填）；新增可选 `cta`。

### 变现现状（2026-09-06，129 处渲染）
| 来源 | 渲染 | 状态 |
|---|---|---|
| ad-006 Bybit（home-banner） | 84 | ✅ 有佣金 |
| promo binance（sidebar-top） | 11 | ✅ 有佣金 |
| promo okx / gate-io / kraken / bitget / coinbase / mexc | 34 | ⏳ **只等 6 个码** |
- **95/129 已能赚（74%），剩余 34 处全部卡在 6 个联盟码上** —— 填码即变现，无需改代码。
- 同日处置：停用 ad-002~005（Ledger/Uniswap/CoinGecko/OpenSea 官网直投，24 处白送流量且
  **优先级高于 promo，等于占着会赚钱的位子**）；5 个 promo 换成联盟表内交易所
  （dexscreener→gate-io，另发现 trezor/coinmarketcap/magic-eden 同样不在表内，一并换）。
  8 个槽位现在 1:1 对应 8 家交易所，无重复。

## 实时行情架构
浏览器组件统一走 `src/utils/coingecko.ts` 的 `cgFetch()`：
1. 优先 `/api/cg/*` —— Pages Function（`functions/api/cg/[[path]].js`），Cache API 缓存 + 并发去重 + 24h 陈旧兜底。
2. 回退访客 IP 直连 —— 边缘 429/5xx 时触发，本页生命周期内不再重试边缘。

✅ **2026-09-04 压测（14 连测，推翻此前所有悲观结论）**：
- 14/14 HTTP 200 零 429，价格随上游变动 → 真取数。
- **`X-CG-Cache` HIT 率 7/8** → Cache API 正常工作，"无 key 时代理 100% 无用"作废。
- **`X-CG-Auth: demo-key` → Demo key 已配置生效**，不用再注册。
- ⚠️ **看缓存要看 `X-CG-Cache`，不要看 `cf-cache-status`**（后者恒为 DYNAMIC，是预期行为，
  看它会误判"缓存没生效"）。查询：`curl -D - ... | grep -i "x-cg-cache\|x-cg-auth"`。
- 回归：`npm run test:cg`（21 断言，mock Cache API + 上游）。

## 部署与 CI
- ✅ **选 A：保留 Wrangler，push 到 main 自动部署**（`deploy-pages.yml`，另可 `workflow_dispatch`）。
  5 个数据 workflow 每天多次 push 到 main，各触发一次部署；concurrency 组串行排队
  （`cancel-in-progress: false`，避免上传中途被砍留半成品）。
  故意**不加 `paths-ignore`**：过滤会新增"推了却没部署"的静默失败类型。规则：push 到 main 就部署。
- ⚠️ **用户尚未执行**：去 CF 后台**断开 Pages Git 集成**（每次 push 仍在构建两次）。
  `Workers & Pages > cryptonav > Settings > Builds & deployments > Disconnect`（不会删项目/域名）。
- `_routes.json` 必须同时有 `include` **和** `exclude` 两个数组（云文档说 exclude 可选，
  Wrangler 源码 `isRoutesJSONSpec()` 要求都是数组）。缺 exclude 曾让所有部署在发布阶段被拒一整天；
  Pages 自带构建器只报 `Failed to publish assets`，Wrangler 会直说 `Invalid _routes.json`。
  常驻校验：`scripts/check-routes-json.mjs`（规则抄自 Wrangler 4.127.1 源码）。
- **CI 警告纪律：健康流水线必须零警告。** 无法判断的检查只输出普通日志（`note()`），
  `::warning::` 只留给可行动项。已用 `scripts/test-cloudflare-token.mjs`（12 用例，
  断言**精确警告数**）锁死 —— 反例：account 级 dashboard token 的 `/user/tokens/verify`
  返回空 permission_groups，导致"有没有 Pages 权限"每次都响，成功部署看着像坏的。

## 链接健康巡检（2026-09-04 上线）
`.github/workflows/check-links.yml`，周二 04:00 UTC，**crawl + outbound 合并在一个文件**
（推 `.github/workflows/` 需 PAT 的 `workflow` scope，一个文件 = 一次授权覆盖两项）。
- crawl：110 URL / 110 内链 / 0 死链 / CI 上 31 秒（本地走代理要 4-5 分钟）。
- outbound：63 个 active 项目官网。
- **只有「确认失效」才让 job 变红**：分类 `ok/block/dead/timeout/error/warn`，
  **只有 dead 影响退出码**。63 个里 18 个（Gate.io、Etherscan、OpenSea…）会挡数据中心 IP 返回 403，
  算成失效就每周报红 → 被当噪音忽略 → 连带淹没真问题。
- 两个脚本都用 **`process.exitCode`，禁用 `process.exit()`**（后者撞 undici keep-alive 句柄，
  Node 24/Windows 上退出码被污染成 127，成功失败都是）。
- 每个 job **先跑自己的契约测试**，先验证检测器没坏再信结论。

### ⚠️ 6 个跨域名重定向都不要改（2026-09-04 决策）
清单 `scripts/known-redirects.json`（每条含日期+理由）。机制：复核过且落点未变 → 安静一行；
**落点变了反而大声报**（域名又动了，可能被卖了）。

| 项目 | 现 URL | 跳到 | 为什么不动 |
|---|---|---|---|
| Curve | curve.fi | curve.finance | 官方改名，品牌域名仍是 .fi |
| 1inch | 1inch.io | 1inch.com | 1inch.com 注册于 **1999**，买来的老域名 |
| dYdX | dydx.exchange | dydx.xyz | 官方换域名 |
| Phantom | phantom.app | phantom.com | phantom.com 注册于 **1992** |
| Arkham | arkhamintelligence.com | info.arkm.com | arkm.com 注册于 **2001** |
| Magic Eden | magiceden.io | magiceden.us/?gr | **不是改名，是地理分流** |

- **前 5 个不改的真正理由**：改 website 会让 longevity 从 7.3/5.8/6.6 年跳到 26.9/34.6/24.9 年，
  **制造 3 个新的 blur 式评分污染**（blur.io 2013 注册 / 2022 上线，评分虚高到 98）。
- **Magic Eden 是另一回事**：`?gr` = geo redirect，Actions 跑在美国才每次看到。
  本站面向国际用户，**必须保留 .io**，改成 .us 会把非美访客送进美国实体站点。

## ⚠️ 本地验证 dist 的坑：dist 不会被清理（2026-09-06）

**本机的 `dist/` 每次构建都不会清空**，旧产物会一直堆积（实测同一目录里混着三批构建的
10 个 `hoisted.*.js` + 3 个 `Layout_*.mjs`）。原因是沙箱的 safe-delete 守卫（阈值 50 个文件）
拦掉了 Astro 的 `emptyOutDir`，也就是 `npm run build` 那个 exit=1 的来源。

- **后果**：`grep -r ... dist/` 会读到上一批甚至上上批的旧文件，**据此得出的结论可能是错的**。
  我因此把"旧文案还在"误判成改动没生效，实际 HTML 引用的是最新那份。
- **正确做法**：先取 HTML 实际引用的资源名，再只查这些文件：
  ```bash
  refs=$(grep -rho 'hoisted\.[A-Za-z0-9_]*\.js' dist --include=*.html | sort -u)
  for h in $refs; do echo "$h 旧=$(grep -c '旧文案' dist/_astro/$h)"; done
  ```
- **不影响线上**：GitHub Actions 每次是干净 runner，dist 从零生成；
  只有本地手动 `wrangler pages deploy dist` 才会把死文件一起传上去 —— 真要手动部署前先换干净目录。

## 已知未完成 / 待用户动作
- **6 个联盟码**（决定 34 处 promo 能否变现）—— 发完整链接即可。
- **Newsletter**：线上 `POST /api/subscribe` 返回 **503**，前端显示
  **"Online signup is not connected yet."**（每个想订阅的访客都看得到，自曝站点未完成）。
  需在 CF Pages 配 `NEWSLETTER_PROVIDER` / `_ENDPOINT` / `_TOKEN` 并**重新部署**；
  或至少先改掉这句文案。
- **Bitmedia/Coinzilla 广告位代码**：8 个槽位全空，建议先贴 `article-top` / `article-bottom`。
- **SPF/DMARC**（见上，需后台手动）。
- Bybit 活动截止日暂设 2026-10-04，待确认；两套 Bybit 链接是否统一
  （卡片 `partner.bybit.com/b/166214` vs 广告 `bybit.com/en/sign-up?affiliate_id=166214`）。
- 其他：Wayback 在 CI 的可用性、blur 评分偏高、arkham 合约数据缺失、`/embed/[slug]` 徽章 BD、
  GitHub Node 20 弃用警告（需改 7 个 workflow 含部署流水线，风险大于收益，暂不动）。

## 路线图与内容现状（压缩）
- 变现优先级：联盟链接 > 广告网络 CPM > Sponsored 标签 > 链页 > 自助投放。
- 已上线内容：compare/ 5 篇对比页、dashboard（恐慌指数+Gas+涨跌榜）、
  `/chain/[slug]`（CoinGecko 6h 刷新）、/airdrops + /unlocks 日历、learn/ 8 篇指南。
  总 174 页。
- SEO 黄金机会："Binance vs Coinbase"（KD=1，月搜 3400）等对比页已建，每页带联盟链接。
- 行业 CPM 基准（2026）：CEX $8-15、DeFi $6-12、钱包 $5-10、NFT $3-8。
- 教训：广告位 ≠ 广告收入（流量→广告主→付费→数据→续费）；新站 DA=0，SEO 需 6-12 月。

## 文档产出
`CryptoNav-产品方案.md`、`CryptoNav-数据采集方案.md`、`CryptoNav-待办操作手册.md`
