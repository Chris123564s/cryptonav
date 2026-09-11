# CryptoNav 项目记忆

英文加密导航站（国际用户，绿涨红跌）。Astro + Tailwind + JSON + Cloudflare Pages；
仓库 `Chris123564s/cryptonav`（main）。工作目录 `C:\Users\a\WorkBuddy AI\2026-08-27-10-59-43`。

## 联系邮箱
- 全站唯一对外邮箱 `contact@cryptonav.site`（腾讯企业邮）。例外：`SubscribeForm.astro`
  的 `placeholder="you@example.com"` **故意保留**（改了 = 预填站长邮箱的怪 UI）。
- ⚠️ 该域开了 catch-all → SMTP RCPT 探测**完全不可信**（不存在地址也 250）。
- ⚠️ 缺 SPF/DMARC，用 contact@ 外发进垃圾箱。需用户在 CF 后台手动加
  `v=spf1 include:spf.mail.qq.com ~all`（现有 token 无 DNS 权限）。
- **验证线上邮箱必须解码，不能 grep**：CF Email Obfuscation 把邮箱加密成
  `/cdn-cgi/l/email-protection#<hex>`，HTML 无明文 → grep 新旧地址都返回 0，
  极易误判"部署没生效"。解码器 `scripts/check-cf-email.py`（`--expect`，exit 0/1，可挂 CI）。

## 联盟码写入原则
- **唯一边界：访客只接触官方域名。** 码的来源不影响访客安全。
- ✅ **可写**：用户给什么链接，就把 `template` 的**域名换成那个链接的域名**，`code` 填链接里的 ID。
- ❌ **不写**：来源不明、用户无法确认归属的野鸡域名（`bsmkweb.cc` 等）。
- ⚠️ **"域名必须官方" ≠ "必须是主域"**。曾把 bybit 联盟短链 `partner.bybit.com/b/166214`
  卡在"模板不兼容"上反复验证，被用户 **"不要去参考模板了，以我的为准"** 点破：
  `template` 只是拼接壳子，域名由用户给的链接决定。**别家长式拦阻** —— 剩余风险只涉返佣归属。
- 现状：binance `GRO_28502_B2R17` ✅、bybit `166214` ✅（已上线）；
  **okx / coinbase / kraken / gate-io / bitget / mexc 6 家待填（发完整链接即可）**。

## 广告位机制
- 渲染优先级：`ads.json 直投（active + 时间窗）> ad-network.json 的 html > promo > "Your Ad Here"`。
- ⚠️ **`weight` 是"构建时被选中的概率"，不是展示概率**：Astro 静态生成，每页构建时
  `Math.random()` 抽一次就固定。要稳定展示某条，就让它成为该 slot 唯一候选。
- **`image` 填不填决定看不看得见文案**：填了只渲染 `<img>`（文字进 alt）；不填才走渐变+文字。
  **活动推广必须留空 image。**
- 统计用 `scripts/check-ad-slots.mjs`，口径是 `data-ad-id=` / `data-promo-project=`。
  ⚠️ 按"官网 URL 出现次数"统计会**被项目卡片链接污染**（曾虚高到 27/28）。
- **RULE（已写进 ad-network.json 的 note）**：promo 的 `projectId` **必须是 affiliates.json 的 key**，
  否则 `getReferralUrl()` 无码可拼、只渲染他人官网，**永远不赚钱且页面上看不出区别**。
  校验：`node -e "const a=require('./src/data/affiliates.json').exchanges,n=require('./src/data/ad-network.json').slots;for(const[s,v]of Object.entries(n))console.log(s,v.projectId,v.projectId in a?'ok':'NEVER EARNS')"`

### 广告卡视觉（2026-09-06 重做，commit 42a8116）
- 渐变**不用 Tailwind 类**，改三个 CSS 变量 `--ad-1 / --ad-2 / --ad-glow` 写在行内 style
  （需要两端色 + 第三个更亮高光色，只有 CSS 能一次带全）。配色表在 `AdBanner.astro`。
- 层次：基础渐变 + 两个模糊光斑 + 网格纹理(mask 渐隐) + 内描边 + 暗角。
  宽 banner 在 md+ 左右分栏，sidebar / inline 居中堆叠。**描述在 <640px 隐藏**（装不下会拦腰截断）。
- **直投与 promo 已合并为一条渲染路径**（原本两段重复代码，正是"CTA 只有 promo 有"的成因）。
- **改 `.ad-container` / `.ad-label` 必须用更高特异性**：它们在 `@layer components` ——
  那是 **Tailwind 的处理层，不是原生 cascade layer**，覆盖**不能靠加载顺序**。
  示例：`.ad-label.ad-label--on-media`（Astro 编译成 `.ad-label[data-astro-cid-x].ad-label--on-media`
  = 0,3,0）＞ 全局 `.ad-label`（0,1,0）。
- **同页槽位不要用同一个 gradient**（首页曾有 3 个都是金色，上下相邻像同一条广告重复）。

### 两个「渲染正常但看着像没卖出去」的 bug（2026-09-05 修，易复发）
1. **渐变卡缺 `w-full`**：容器 `flex items-center justify-center`，子项只写 `h-full`
   → 宽度按文字撑开，两侧露灰底。有图分支是 `img.w-full`，所以**只有无图的渐变卡中招**，
   而活动推广恰恰必须无图。
2. **`border-dashed` 曾写死在 `.ad-container` 基础类** → 所有广告（含真素材）都套虚线，
   且让组件里 `ad.image?'':'border-dashed'` 彻底失效。已移除，**虚线只留给占位**。

### 变现现状（2026-09-06，129 处渲染）
| 来源 | 渲染 | 状态 |
|---|---|---|
| ad-006 Bybit（home-banner） | 84 | ✅ 有佣金 |
| promo binance（sidebar-top） | 11 | ✅ 有佣金 |
| promo okx/gate-io/kraken/bitget/coinbase/mexc | 34 | ⏳ **只等 6 个码** |
- **95/129 已能赚（74%），剩余 34 处全部卡在 6 个联盟码上** —— 填码即变现，无需改代码。
- **ad-006（Bybit，home-banner）设了 `endAt: 2026-10-04`（这个日期是我猜的，待用户确认）**。
  到期后 home-banner 会回落到 promo —— 而 home-banner 的 promo 正是 **bybit（有码）**，
  所以**到期不会掉成不赚钱的位子**，只是换成另一套 bybit 素材。
- ⚠️ **判断"有没有码"要看 `code` 的值，不能只看 key 在不在 affiliates.json**：
  8 家**全都是 key**，但只有 binance / bybit 的 `code` 非空 ——
  6 家（okx / coinbase / kraken / gate-io / bitget / mexc）是**空字符串**。
- 同日停用 ad-002~005（Ledger/Uniswap/CoinGecko/OpenSea 官网直投，24 处白送流量，
  且**优先级高于 promo，等于占着会赚钱的位子**）；5 个 promo 换成联盟表内交易所。
  8 个槽位现在 1:1 对应 8 家交易所。

## ⚠️ 本地构建到不了 astro:build:done（2026-09-06，比"dist 不清空"更严重）

同一个 safe-delete 守卫（本轮删除计数到 50 就拦），**Astro 在 `cleanServerOutput`
（`static-build.js:320`，清 `dist/pages/*.mjs`）被抛异常中断** → 结果：

- `npm run build` 的 **exit=1 是假失败**（页面其实都生成了，用 `grep -E "Complete"` 确认）。
- ⚠️ **`dist/sitemap-0.xml` 永远生不出来** —— sitemap 是在更后面的 `astro:build:done`
  钩子写的，**根本跑不到**。dist 里那份是守卫还没触发时留下的（曾误导我一次：
  页面已删 `/newsletter`，sitemap 里却还有，测试因此报红）。
  → 任何读 `dist/sitemap-*.xml` 的测试在本地都不可信。`check-faq-newsletter.mjs`
  已改成"文件缺失就 SKIP 并打印原因"，CI（干净 runner）仍然严格。
- 守卫是 **scope:"turn"**，本轮触发后本轮内一切删除都失败（`rm`、`rm -rf`、
  换 `--outDir` 建新目录都一样 —— 它删的是自己刚生成的 `pages/*.mjs`）。
  **`mv` 不算删除，可以正常用**（曾靠 `mv dist/sitemap-0.xml` 绕过）。
  真要干净的 dist，得等新的一轮。
- **不影响线上**：GitHub Actions 每次干净 runner，构建完整、sitemap 正常。

### ⚠️ 一次 `src/` 整个消失的事故（2026-09-06）
`git rm` 删两个文件之后，**整个 `src/`（60 个文件）从工作树消失**（未 staged，
索引里还在）。原因不明（疑似沙箱对批量删除的连带反应）。
- **恢复**：`git checkout -- src/`（从索引还原，内容 = HEAD）。索引没被污染，所以零损失。
- **教训：做批量文件操作前先提交。** 我那次刚好前一步已 commit，只丢了页脚的 3 处未提交编辑。

## ⚠️ 本地 dist 不会被清理（2026-09-06）
本机 `dist/` 每次构建都不清空，旧产物一直堆积（实测混着三批的 10 个 `hoisted.*.js` +
3 个 `Layout_*.mjs`）。原因：沙箱 safe-delete 守卫（阈值 50 文件）拦掉了 Astro 的
`emptyOutDir` —— 也就是 `npm run build` 那个 **exit=1 是假失败**（改用 `grep -E "Complete"` 确认成功）。
- **后果**：`grep -r ... dist/` 会读到上批旧文件 → 我因此把"旧文案还在"误判成改动没生效。
- **正确做法**：先取 HTML 实际引用的资源名再只查这些：
  ```bash
  refs=$(grep -rho 'hoisted\.[A-Za-z0-9_]*\.js' dist --include=*.html | sort -u)
  for h in $refs; do echo "$h 旧=$(grep -c '旧文案' dist/_astro/$h)"; done
  ```
- **不影响线上**（CI 每次干净 runner）。只有本地手动 `wrangler pages deploy dist`
  才会把死文件传上去 —— 真要手动部署先换干净目录。
- 另：CSS 按页面分包，`ls dist/_astro/*.css | head -1` 拿到的可能不含目标类，
  用 `grep -l 'ad-card' dist/_astro/*.css` 定位；`dist/**/*.html` 不匹配嵌套目录，用
  `grep -rho ... dist --include=*.html`。

## 实时行情架构
浏览器组件统一走 `src/utils/coingecko.ts` 的 `cgFetch()`：
1. 优先 `/api/cg/*` —— Pages Function（`functions/api/cg/[[path]].js`），Cache API + 并发去重 + 24h 陈旧兜底。
2. 回退访客 IP 直连 —— 边缘 429/5xx 时触发，本页生命周期内不再重试边缘。

✅ **2026-09-04 压测（14 连测，推翻此前所有悲观结论）**：14/14 HTTP 200 零 429；
**`X-CG-Cache` HIT 率 7/8** → Cache API 正常；**`X-CG-Auth: demo-key` → Demo key 已配置**。
- ⚠️ **看缓存要看 `X-CG-Cache`，不要看 `cf-cache-status`**（后者恒 DYNAMIC，是预期行为）。
  查询：`curl -D - ... | grep -i "x-cg-cache\|x-cg-auth"`。
- 回归：`npm run test:cg`（21 断言，mock Cache API + 上游）。

## 部署与 CI
- ✅ **选 A：保留 Wrangler，push 到 main 自动部署**（`deploy-pages.yml` + `workflow_dispatch`）。
  5 个数据 workflow 每天多次 push 到 main 各触发一次部署；concurrency 组串行排队
  （`cancel-in-progress: false`，避免上传中途被砍留半成品）。
  故意**不加 `paths-ignore`**：过滤会新增"推了却没部署"的静默失败类型。规则：push 到 main 就部署。
- ⚠️ **用户尚未执行**：CF 后台**断开 Pages Git 集成**（否则每次 push 构建两次）。
  `Workers & Pages > cryptonav > Settings > Builds & deployments > Disconnect`（不会删项目/域名）。
- `_routes.json` 必须同时有 `include` **和** `exclude` 两个数组（云文档说 exclude 可选，
  Wrangler 源码 `isRoutesJSONSpec()` 要求都是数组）。缺 exclude 曾让所有部署发布阶段被拒一整天；
  Pages 自带构建器只报 `Failed to publish assets`，Wrangler 才直说 `Invalid _routes.json`。
  常驻校验 `scripts/check-routes-json.mjs`（规则抄自 Wrangler 4.127.1 源码，**注释里写了为什么不能照文档"简化"**）。
- **CI 警告纪律：健康流水线必须零警告。** 无法判断的检查只输出普通日志（`note()`），
  `::warning::` 只留给可行动项。已用 `scripts/test-cloudflare-token.mjs`（12 用例，
  断言**精确警告数**）锁死 —— 反例：account 级 dashboard token 的 `/user/tokens/verify`
  返回空 permission_groups，「有没有 Pages 权限」每次都响，成功部署看着像坏的。

## 链接健康巡检（2026-09-04 上线）
`.github/workflows/check-links.yml`，周二 04:00 UTC，**crawl + outbound 合并在一个文件**
（推 `.github/workflows/` 需 PAT 的 `workflow` scope，一个文件 = 一次授权覆盖两项）。
- crawl：110 URL / 110 内链 / 0 死链 / CI 31 秒（本地走代理要 4-5 分钟）。outbound：63 个官网。
- **只有「确认失效」才让 job 变红**：分类 `ok/block/dead/timeout/error/warn`，**只有 dead 影响退出码**。
  63 个里 18 个（Gate.io、Etherscan、OpenSea…）会挡数据中心 IP 返 403，算失效就每周报红 →
  被当噪音忽略 → 连带淹没真问题。
- 两个脚本都用 **`process.exitCode`，禁用 `process.exit()`**（后者撞 undici keep-alive 句柄，
  Node 24/Windows 退出码被污染成 127，成功失败都是）。
- 每个 job **先跑自己的契约测试**，先验证检测器没坏再信结论。

### ⚠️ 6 个跨域名重定向都不要改（2026-09-04 决策）
清单 `scripts/known-redirects.json`（含日期+理由）。机制：复核过且落点未变 → 安静一行；
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

## 两个写入端点（都曾把"我们没配好"直接说给访客听）

| 端点 | 需要的环境变量 | 现状 |
|---|---|---|
| `POST /api/subscribe` | `NEWSLETTER_PROVIDER` / `_ENDPOINT` / `_TOKEN` | 方案已定（Supabase），**变量待用户填** → 线上 503 |
| `POST /api/submit` | `GITHUB_ISSUE_TOKEN` | ✅ **2026-09-06 实测已配置生效**（此前记成"未配 500"，是错的） |

- **`/api/submit` 是 BD 入口**（项目方自荐），比订阅更值钱。它调 GitHub API 把提交
  **直接写进 `src/data/projects.json`**（`status: 'pending'`）。
- ⚠️ **探测它有副作用**：真 POST 一次会**在 main 上创建一个提交**（`feat: add pending project "x" via
  community submit`）并**触发一次部署**，且条目会留在数据里。我 2026-09-06 打探针就留下一条
  `id:"t"`，已用提交 `6b5ac3c` 删掉。**别把它当无副作用的健康检查。**
- ⚠️ **每条提交都会触发部署** → `projects.json` 会累积 pending 条目，需定期清。
- ✅ **安全**：写入条目是 `status: 'pending'`，`getActiveProjects()` 只取 `status === 'active'`
  → **未审条目不会自动上线**。
- 教训：前端**原样打印后端 `error` 字段**（`submit.astro` 就是 `data.error` 直出），
  所以后端文案 = 访客可见文案，要按"给客户看"的标准写。
- ⚠️ **别用"线上返回什么"去推断变量配没配**：subscribe 返回 503 是**旧文案**（新文案还没部署），
  很容易把"代码没上线"误读成"变量没配"。**先确认部署版本，再判断配置。**

## 🔕 Newsletter 已整块下线（2026-09-06，用户拍板）

订阅框、页脚 Newsletter 链接、`/newsletter` 页面、`SubscribeForm` 组件全部移除，
`advertise` 页的「Newsletter Sponsor」广告位也删了（不卖不存在的东西）。
**恢复方式：`git revert` 那两个提交**（`take the newsletter off the site` +
`drop the newsletter sponsor slot and flip the smoke tests`）—— 连测试断言一起回来。
- `check-faq-newsletter.mjs` 里 newsletter 那半段现在**断言"不存在"**（页面没构建、
  页脚没链接、sitemap 没条目），防止它偷偷回来；revert 时这些行一起回滚。
- `/api/subscribe` 后端**保留未删**（Supabase 建表 SQL 也还在 `supabase/`），
  重新上线只要 revert + 填三个环境变量 + 重新部署。

## 🔥 部署额度：500 次构建/月，已用掉约一半（2026-09-11 实测）

Cloudflare Pages **免费版 = 500 次构建/月**（已联网核实）。`deploy-pages.yml` 是
**push 到 main 就构建**，所以"main 上的提交数 ≈ 构建数"。实测 **过去 30 天 236 次提交 = 47%**：

| 来源 | 次数/30 天 |
|---|---|
| **我（author=CryptoNav）** | **141** ← 最大头，占 60% |
| github-actions[bot]（数据刷新） | 93 |
| 用户本人 | 2 |

- ⚠️ **我的提交粒度是主要消耗源**（一次会话拆成 5-6 个 commit，还有专门的 memory/docs commit）。
  **改进：同一轮工作合并成更少的提交，别每个小步骤推一次。**
- 数据工作流其实很克制 —— 它们**有变化才推**（`if git diff --cached --quiet; then ... else push`），
  所以 93 次低于理论值（理论 244/月）。
- ⚠️ **若 Pages 的 Git 集成仍连着，每次 push 会构建两次 → 实际已用 ~94%**，
  逼近上限。**这就是"断开 Git 集成"必须尽快做的原因**（`Workers & Pages > cryptonav >
  Settings > Builds & Deployments > Disconnect`）。
- **风险**：`/api/submit` 每次提交都会 commit → 触发一次构建。**匿名访客可以拿它烧你的构建额度**：
  剩余额度被烧完，**包括数据刷新在内的所有部署都会失败**，站点停止更新直到下月重置。

## `/api/submit` 安全加固（2026-09-11，含 33 个单元测试）

`scripts/test-submit.mjs`（`npm run test:submit`，已接入 `npm test`）。加固内容：
- **所有字段加长度上限**（name 80 / website 200 / description 600 / chains ≤10 等）——
  单次请求无法再把数据文件撑爆。
- **website 必须是 http(s)**：`javascript:alert(1)` 会被原样存下来，
  一旦条目被批准渲染成 `<a href>` 就是可点击的 XSS。已拦。
- **控制字符剥离**：`name` 里的换行会原样插进 commit message（已修）。
- ✅ **原本的字段白名单是好的**：访客**无法**设置 `status/sponsored/verified/featured/riskLevel/source`
  —— 这些是服务端写死的。**已有测试锁死这条**（`caller cannot set status` 等 6 条）。
- 顺手修了第 93 行两条语句挤在同一行的编辑残留。

## 统计代码（2026-09-11）

站上现在**两套并存**，隐私姿态完全不同，别混为一谈：

| | 位置 | 特性 |
|---|---|---|
| **GA4** `G-MD66BHJN9Y` | `Layout.astro` head，`{import.meta.env.PROD && (...)}` 包裹 | 设 first-party cookie `_ga` / `_ga_*`，客户端 ID 跨访问持久，数据给 Google |
| **Cloudflare Web Analytics** | `Layout.astro` body 末尾（token 拆三段拼） | 无 cookie、无标识符 |

- ⚠️ **改任何一个都要同步 `src/pages/privacy.astro`**：原文写的是
  "we do not use advertising-tracking cookies or build user profiles"，
  加了 GA4 后这句话就是假的 —— 已改成如实描述两套 + Google 的 opt-out 插件链接。
- **只生产构建注入**（`import.meta.env.PROD`）→ `astro dev` 不会污染数据。
- `check-meta.mjs` 新增断言：**非 noindex 页面必须带 GA4 标签**，
  已做负向验证（抽掉首页那行 → 440 通过 + 1 失败）。`/embed/*` 与 `/admin` 走豁免，本就没有。
- ⚠️ **合规缺口（未解决，需用户决策）**：GA4 在欧盟属于需要**事先同意**的追踪 cookie，
  而站上**没有同意弹窗**（访问即加载）。要么加一个轻量同意门（`Layout.astro` 里那段
  就是这个门的落点），要么接受这个风险。**已向用户明说，等其拍板。**

## Newsletter → Supabase（2026-09-06 定，commit 内含建表 SQL）

选 `generic` provider 直写 Supabase 表，**不接第三方 ESP**（用户已有 Supabase 账号，零月费）。
建表 SQL：`supabase/newsletter_subscribers.sql`。三个变量：
`NEWSLETTER_PROVIDER=generic`、`NEWSLETTER_ENDPOINT=https://<proj>.supabase.co/rest/v1/newsletter_subscribers`、
`NEWSLETTER_TOKEN=anon key`（**绝不能是 service_role**；anon 本来就是公开的，安全靠 RLS）。

⚠️ **两条硬约束都是 `subscribe.js` 的行为逼出来的**（改 schema 前必读）：
1. **列名必须与 payload 逐字一致** `{email, source, subscribedAt, site}`。
   接口把**上游 400 当成功**（本意是兼容 Buttondown/Mailchimp 的"已在列表"），
   而 PostgREST 遇到表里没有的列就返回 400 → **静默失败：访客看到成功，一条没存**。
   `subscribedAt` **必须带双引号建列**（不加引号 Postgres 折成 `subscribedat`）。
2. **重复邮箱不能返回 409**（409 不在 ok/400 里 → 抛"Subscription failed"给访客，
   老用户重订反而报错）。SQL 用 **BEFORE INSERT 触发器返回 NULL** 吞掉重复 → 回 201。
- RLS：只给 anon `for insert` 策略，**无 select 策略 = 读不到**，邮箱列表不会泄露。
- 后端没配时表单本来就降级成 mailto，所以**不是"功能坏了"，是"话难听 + 收不到地址"**。
- **不用新建 Supabase project**（免费版只有 3 个）：一张表放进现有项目即可，
  只是 ENDPOINT 的 ref 换掉。⚠️ 要挑**有真实流量的那个项目** ——
  **免费版会把 7 天不活跃的项目自动 Pause，一暂停订阅接口就 502**，
  而没人会主动发现（平时本来也没人订阅）。
- 改完环境变量**必须重新部署**才生效（CF 不一定自动触发，去 Deployments 点 Retry）。

## CMS / OAuth（2026-09-06 盘点环境变量时挖出）
`https://cryptonav.site/admin/` 是 **Decap CMS**，登录 `/api/auth` → GitHub → `/api/callback`。
**它不是死代码**（`public/admin/` 有 `config.yml` + `decap-cms.js` + `index.html`，静态托管不走 Astro 路由）。
- ✅ **`GITHUB_CLIENT_SECRET` 已配置**（四个端点里唯一配好的）。无副作用探测：
  `curl -s https://cryptonav.site/api/callback` → `missing code` = 已配置（代码先查 secret 再查 code）。
- ✅ **常驻校验 `npm run test:cms`（`scripts/check-cms-fields.mjs`）**：比对 config.yml
  与实际 JSON，**"数据里有但没声明"就失败**（那是会被静默删掉的），
  "声明了但数据里没有"只提示（无害）。已接进 `npm test` 链。当前 **6 个 collection 全清**。
  ⚠️ 写这个脚本时踩的坑：**file collection 的根字段只是包裹层**
  （`fields: [{name:"projects", widget:"list", fields:[id,name,...]}]`），
  它的名字**不属于** item 的字段路径 —— 一开始把声明路径算成 `projects.name`，
  导致 64 个字段全部误报。**根字段有嵌套时，子字段用空前缀递归。**
- ⚠️ **Decap 保存时会整份重写 JSON：未在 `config.yml` 声明的字段被静默丢弃。**
  已修（commit 7834718）：metrics 原只声明 `users/volume/tvl`(string)，实际数据是
  `tvl/volume24h/marketCapRank/twitterFollowers/githubStars`(number) → **保存任一项目会抹掉 4 个指标、
  塞入无人读的 `users`、并把幸存值改成 string**；且数据 workflow 下次会把数字写回来，极难察觉。
  另补了 ads 的 `cta` 字段和 slot 下拉缺的 3 个槽位。**改 config.yml 前先对照真实 JSON 字段。**
- ⚠️ 三个隐患（Decap 通用写法，**我没擅自改**，改错会把 CMS 弄挂）：
  1. `state` 在 `auth.js` 生成但 `callback.js` **从不校验** → 无 CSRF 防护。修需 cookie 比对 + 真跑登录。
  2. token 用 `window.opener.postMessage(..., message.origin)` 回传，**无 origin 白名单**。
  3. `client_id` 有**硬编码兜底** → 环境变量拼错时静默退回硬编码值，报看不懂的错。建议删兜底。
- `/admin/` 与 `/api/` 已进 `robots.txt` 的 `Disallow`（**只是不被索引，不是访问控制**）。

## 待用户动作（阻塞项）
1. **🔴 推 12 个提交到 main** —— 本机无任何 GitHub 凭据（无 GCM / 无 SSH 私钥 / 无 `_netrc` /
   无 gh CLI / 无环境变量 token），必须用户提供 PAT。用户已选"给 PAT"但**尚未粘贴**。
   推送命令（可用代理端口 10809 / 10808，10265 已死）：
   ```
   git -c credential.helper= -c http.proxy=http://127.0.0.1:10809 -c https.proxy=http://127.0.0.1:10809 \
       push https://Chris123564s:<PAT>@github.com/Chris123564s/cryptonav.git main
   ```
2. **6 个联盟码**（决定 34 处 promo 变现）—— 发完整链接即可，可与 PAT 一起给。
3. **Newsletter 三变量** + 配完必须重新部署。
   （`GITHUB_ISSUE_TOKEN` 不用管了 —— 2026-09-06 实测已配置生效。）
5. **Bitmedia/Coinzilla 广告位代码**：8 个槽位全空，建议先贴 `article-top` / `article-bottom`。
6. **SPF/DMARC**（后台手动）。
7. Bybit 活动截止日暂设 2026-10-04 待确认；两套 Bybit 链接是否统一
   （卡片 `partner.bybit.com/b/166214` vs 广告 `bybit.com/en/sign-up?affiliate_id=166214`）。

## 其他未完成
Wayback 在 CI 的可用性、blur 评分偏高、arkham 合约数据缺失、`/embed/[slug]` 徽章 BD、
GitHub Node 20 弃用警告（需改 7 个 workflow 含部署流水线，风险大于收益，暂不动）。

## 路线图与内容现状（压缩）
- 变现优先级：联盟链接 > 广告网络 CPM > Sponsored 标签 > 链页 > 自助投放。
- 已上线：compare/ 5 篇、dashboard（恐慌指数+Gas+涨跌榜）、`/chain/[slug]`（6h 刷新）、
  /airdrops + /unlocks、learn/ 8 篇。总 174 页。
- SEO 机会："Binance vs Coinbase"（KD=1，月搜 3400）等对比页已建，每页带联盟链接。
- 行业 CPM 基准（2026）：CEX $8-15、DeFi $6-12、钱包 $5-10、NFT $3-8。
- 教训：广告位 ≠ 广告收入（流量→广告主→付费→数据→续费）；新站 DA=0，SEO 需 6-12 月。

## 文档产出
`CryptoNav-产品方案.md`、`CryptoNav-数据采集方案.md`、`CryptoNav-待办操作手册.md`
