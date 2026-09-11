# CryptoNav 项目记忆

英文加密导航站（国际用户，绿涨红跌）。Astro + Tailwind + JSON + Cloudflare Pages；
仓库 `Chris123564s/cryptonav`（main）。工作目录 `C:\Users\a\WorkBuddy AI\2026-08-27-10-59-43`。
**本文件只放"必须遵守的规则与结论"**；过程细节在 `.workbuddy-ai/memory/YYYY-MM-DD.md`，
可复用流程在 `~/.workbuddy-ai/skills/`。最后整理：2026-09-11。
---

## 🔴 待用户动作（按优先级）

1. **6 个联盟码**：okx / coinbase / kraken / gate-io / bitget / mexc —— `code` 目前是**空字符串**，
   发完整链接即可，34 处 promo 立刻变现（规则见「联盟码」）。
2. **关掉 Cloudflare Managed robots.txt**（后台一个开关）—— 它在平台层注入了
   `Amazonbot: Disallow: /`，覆盖了我们仓库文件里明确的 `Allow: /`；通配组 `Content-Signal`
   也出现两套矛盾值。
3. **GA4 欧盟同意弹窗** —— 欧盟需事先同意的追踪 cookie，站上访问即加载。落点 `Layout.astro`。
4. **Bitmedia/Coinzilla 广告位代码**：8 个槽位全空，建议先贴 `article-top`/`article-bottom`。
5. **SPF/DMARC**：后台手动加 `v=spf1 include:spf.mail.qq.com ~all`（token 无 DNS 权限）。
6. Bybit 活动截止日暂设 `2026-10-04`（我猜的，待确认）。
7. **战略拍板**：商业页是否重写到 1200+ 词并加第一方经验（5 倍投入）；是否继续加页（见「SEO 审计」）。

**已修复、无需再跟**：`/api/submit` 构建 DoS；`/newsletter` 已整块下线。
**⚠️ 反转项**：**不要断开 CF Pages Git 集成**（旧待办，照做会静默停更 —— 见「部署」节）。

---

## 联盟码写入原则
- **唯一边界：访客只接触官方域名。** 码的来源不影响访客安全。
- ✅ **可写**：用户给什么链接，就把 `template` 的**域名换成那个链接的域名**，`code` 填链接里的 ID。
- ❌ **不写**：来源不明、用户无法确认归属的野鸡域名（`bsmkweb.cc` 等）。
- ⚠️ **"域名必须官方" ≠ "必须是主域"**：`template` 只是拼接壳子，域名由用户给的链接决定。
  用户已明说 **"不要去参考模板了，以我的为准"** —— **别家长式拦阻**，剩余风险只涉返佣归属。
- 现状：binance `GRO_28502_B2R17` ✅、bybit `166214` ✅；其余 6 家待填。

---

## 广告位机制
- 优先级：`ads.json 直投（active + 时间窗）> ad-network.json 的 html > promo > "Your Ad Here"`。
- ⚠️ **`weight` 是"构建时被选中的概率"，不是展示概率**（Astro 静态生成，每页构建时
  `Math.random()` 抽一次就固定）。要稳定展示某条，就让它成为该 slot 唯一候选。
- **`image` 填不填决定看不看得见文案**：填了只渲染 `<img>`（文字进 alt）；不填才走渐变+文字。
  **活动推广必须留空 image。**
- **RULE**：promo 的 `projectId` **必须是 affiliates.json 的 key**，否则 `getReferralUrl()` 无码可拼、
  只渲染他人官网，**永远不赚钱且页面上看不出区别**。
- ⚠️ **判断"有没有码"要看 `code` 的值，不能只看 key 在不在**：8 家全是 key，只有 2 家 `code` 非空。
- 统计用 `scripts/check-ad-slots.mjs`，口径是 `data-ad-id=` / `data-promo-project=`。
  ⚠️ 按"官网 URL 出现次数"统计会**被项目卡片链接污染**（曾虚高到 27/28）。- 视觉：渐变**不用 Tailwind 类**，用行内 CSS 变量 `--ad-1 / --ad-2 / --ad-glow`（配色表在
  `AdBanner.astro`）。**改 `.ad-container` / `.ad-label` 必须用更高特异性** —— 它们在
  `@layer components`（**Tailwind 的处理层，不是原生 cascade layer**），覆盖**不能靠加载顺序**。
- 现状：129 处渲染，**95/129 已能赚（74%）**，剩余 34 处全卡在 6 个联盟码上。
  ad-006（Bybit, home-banner）`endAt: 2026-10-04`，到期回落到 promo（正是 bybit，有码），**不会掉成不赚钱的位子**。

---

## ⚠️ 沙箱 safe-delete 守卫：一个根因，五个后果
阈值 **50 个文件**、`scope:"turn"`。触发后**该轮内一切删除都失败**（`rm`、`rm -rf`、
换 `--outDir` 建新目录都一样）。**`mv` 不算删除，可正常用。**
1. **本地构建到不了 `astro:build:done`**（在 `cleanServerOutput` 被抛异常中断）→
   `npm run build` 的 **exit=1 是假失败**（用 `grep -E "Complete"` 确认）。
2. **`dist/sitemap-0.xml` 本地永远生不出来** → **读 `dist/sitemap-*.xml` 的测试在本地都不可信**
   （CI 干净 runner 仍严格）。
3. **本地 `dist/` 不清空**，旧产物一直堆 → `grep -r ... dist/` 会读到上批旧文件，把"旧文案还在"
   误判成改动没生效。**正确做法**：先取 HTML 实际引用的资源名再只查这些
   （`grep -rho 'hoisted\.[A-Za-z0-9_]*\.js' dist --include=*.html | sort -u`）。
   CSS 按页面分包（`grep -l 'ad-card' dist/_astro/*.css` 定位）；`dist/**/*.html` **不匹配嵌套目录**。
4. **手动部署会把死文件传上去** —— 真要 `wrangler pages deploy` 先换干净目录。
5. **`git` 的自我维护本身就是批量删除**（fetch 换 pack、merge/gc 删对象）→ 撞守卫 → **`.git` 被毁**。

**不影响线上**（CI 每次干净 runner）。**两次目录消失事故**：① `src/`（60 文件）→ `git checkout -- src/` 恢复；
② **`.git/refs/` + `objects/pack/*.pack` 全被删** → 恢复流程已固化为技能
**`recover-destroyed-git-repo`**（reflog 是命根子；`refs/remotes/` 写入**不持久**，要用本地分支中转；
`git fsck` 刷 `failed to load pack entry` = 僵尸 `.idx`，先移走）。
**教训：做批量文件操作前先提交。**

⚠️ **Vite 过期缓存致构建崩溃**：`node_modules/.vite/deps_temp_*` 删不动 →
`TypeError: msg.includes is not a function`。**症状与代码改动无关，极具迷惑性。** 修复：`mv` 走。

---

## 实时行情架构
浏览器组件统一走 `src/utils/coingecko.ts` 的 `cgFetch()`：① 优先 `/api/cg/*`（Pages Function，
Cache API + 并发去重 + 24h 陈旧兜底）；② 边缘 429/5xx 时回退访客 IP 直连。
✅ 压测：14/14 HTTP 200 零 429，`X-CG-Cache` HIT 率 7/8。
⚠️ **看缓存看 `X-CG-Cache`，不要看 `cf-cache-status`**。回归：`npm run test:cg`。

---

## 部署与 CI
- ✅ **保留 Wrangler，push 到 main 自动部署**（`deploy-pages.yml` + `workflow_dispatch`）。
  concurrency 串行排队。故意**不加 `paths-ignore`** —— 过滤会新增"推了却没部署"的静默失败类型。
- **CI 只跑 `npm ci && npm run build`，不跑 `npm test`** → 能阻断 CI 的只有**构建期**报错。
- `_routes.json` 必须同时有 `include` **和** `exclude` 两个数组（Wrangler 源码
  `isRoutesJSONSpec()` 要求都是数组；云文档说 exclude 可选是**错的**）。缺 exclude 曾让所有部署
  发布阶段被拒一整天，且 Pages 构建器只报含糊的 `Failed to publish assets`。
  常驻校验 `scripts/check-routes-json.mjs`。
- **CI 警告纪律：健康流水线必须零警告。** 无法判断的检查只输出普通日志（`note()`），
  `::warning::` 只留给可行动项（`scripts/test-cloudflare-token.mjs` 断言**精确警告数**）。

### 🔥 部署额度与「谁来构建」（2026-09-11 实测，推翻旧结论）
- ⭐ **`GITHUB_TOKEN` 推送不会触发其他工作流**（GitHub 官方防递归）。5 个数据工作流全用
  `secrets.GITHUB_TOKEN` → **它们推的提交不跑 `deploy-pages.yml`**，只有 CF Git 集成在构建。
  真人凭据推送 → workflow **＋** Git 集成（**两遍**）；机器人推送 → **只有 Git 集成**。
- **证据**：近 12 天逐日比对 11/12 吻合；9-07~9-10（机器人 29 / 真人 0）→ 部署 **0** 次。
- 🔴 **所以绝对不要断开 CF Pages Git 集成** —— 断掉后机器人推送既不触发 workflow、又没了 Git 集成，
  **没有任何东西会构建它，而且不报错**（站点看着正常、数据一天天变旧，最难发现的故障）。
  **省事（推荐）**：Git 集成不动；想省真人推送的两遍构建，就删 `deploy-pages.yml` 或去掉其 `push:` 触发。
  **要 Wrangler 当唯一通道**：先把 5 个数据工作流的 checkout token 换成 PAT。
- **额度**：实测本 workflow 近 30 天只跑 **46 次（9.2%）**，含 Git 集成合计约 **50-56%**。
  **"逼近上限"那条结论作废。** 构建额度**按 push 次数算，不按 commit 数**。

---

## 链接健康巡检
`.github/workflows/check-links.yml`（周二 04:00 UTC，crawl + outbound 合并在一个文件 ——
推 `.github/workflows/` 需 PAT 的 `workflow` scope）。crawl：110 URL / **0 死链**。outbound：63 个官网。
- **只有「确认失效」才让 job 变红**。63 个里 18 个会挡数据中心 IP 返 403，算失效就每周报红 →
  被当噪音忽略 → 淹没真问题。
- 脚本用 **`process.exitCode`，禁用 `process.exit()`**（后者撞 undici keep-alive 句柄，
  Node 24/Windows 退出码被污染成 127，成功失败都是）。每个 job **先跑自己的契约测试**。
- ⚠️ **6 个跨域名重定向都不要改**（理由在 `scripts/known-redirects.json`）：Curve/1inch/dYdX/
  Phantom/Arkham 改了会让 longevity 跳到 24-35 年，**制造 blur 式评分污染**；
  **Magic Eden 的 `.io → .us/?gr` 是地理分流，必须保留 .io**。

---

## 写入端点 `/api/submit`（BD 入口）
- 调 GitHub API 把提交**直接写进 `src/data/projects.json`**（`status: 'pending'`）。
  `GITHUB_ISSUE_TOKEN` ✅ 已配置。
- ⚠️ **探测它有副作用**：真 POST 一次会**在 main 上创建提交**并**触发一次部署**。**别当无副作用的健康检查。**
- ✅ **安全**：字段白名单让访客**无法**设置 `status/sponsored/verified/featured/riskLevel/source`
  → 提交必然是 `pending`，`getActiveProjects()` 只取 `active`。
- 教训：前端**原样打印后端 `error` 字段** → 后端文案 = 访客可见文案，按"给客户看"的标准写。
  ⚠️ **别用"线上返回什么"去推断变量配没配** —— 很容易把"代码没上线"误读成"变量没配"。
- 加固（`scripts/test-submit.mjs`）：字段长度上限；website 必须 http(s)（否则 `javascript:`
  会存下来，批准后渲染成 `<a href>` 就是可点击 XSS）；控制字符剥离。

### 🔴🔴 曾存在的构建 DoS（已修，2026-09-11）
`src/pages/verify/[slug].astro` 的 `getStaticPaths` 原本遍历**全部** projects + `if (!s) throw`；
而 `/api/submit` 追加的 `pending` 条目**没有**安全记录 → 构建中断，**坏条目留在 JSON 里 →
之后每一次构建都失败**，CF 继续服务上一个好版本 → **站点不挂、不报错、静默停更**。
**一发匿名请求即可让后续所有部署永久失败。** 这是 2026-09-06 那次部署失败（`86f8ee6`）的真因。
**修复**：`verify/[slug].astro` 与 `embed/[slug].astro` 改用 `getActiveProjects()`；
**那个 `throw` 故意保留**（active 项目缺记录是真错误）。`check-safety.mjs` 断言口径同步改 active，
并**新增源码级守卫**（读两个 `.astro` 的 `getStaticPaths` 块，要求含 `getActiveProjects()`
且不含 `projects.map`）——**注释拦不住人，测试可以**。

---

## 🔕 Newsletter 已整块下线（用户拍板）
订阅框、页脚链接、`/newsletter` 页面、`SubscribeForm`、advertise 页的 Sponsor 广告位全部移除。
**恢复方式：`git revert` 那两个提交**。`/api/subscribe` 后端保留未删，Supabase SQL 在 `supabase/`。
⚠️ 若重新启用：列名必须与 payload **逐字一致** `{email, source, subscribedAt, site}`
（`subscribedAt` **必须带双引号建列**），且**重复邮箱不能返回 409** —— 两条都是
`subscribe.js` 把**上游 400 当成功**逼出来的，违反任一条就**静默丢数据**。

---

## 统计代码
两套并存：**GA4 `G-MD66BHJN9Y`**（`Layout.astro` head，`import.meta.env.PROD` 包裹，设 `_ga` cookie）
+ **Cloudflare Web Analytics**（body 末尾，无 cookie）。
- ⚠️ **改任何一个都要同步 `src/pages/privacy.astro`**（原文"we do not use advertising-tracking
  cookies"在加了 GA4 后就是假的）。`check-meta.mjs` 断言**非 noindex 页面必须带 GA4 标签**。

### ⭐ 「GA4 检测不到」的真相（实测，别再重复排查）
**代码没问题，标签真的在上报。是"看的人"的网络到不了 Google。**
- ✅ 端到端实证（`scripts/check-ga-live.mjs`，真实 Chrome 走 CDP）：挂代理时 `gtag.js → 200`、
  `/g/collect → 204`、`_ga` + `_ga_MD66BHJN9Y` 已种下。❌ 不挂代理：`net::ERR_SSL_PROTOCOL_ERROR`、
  `collectRequests: 0`、无 `_ga`。
- ⚠️ **`window.gtag` 和 `dataLayer.length` 证明不了任何事** —— 它们由**我们自己的内联片段**定义，
  gtag.js 完全没加载也照样是 `function` / 有长度。**只有 `collectRequests` 和 `_ga` cookie 是真信号。**
- ⚠️ **Chrome 不读 `https_proxy`**，必须 `--proxy-server=` 显式传。**curl 走代理能通 ≠ 浏览器能通。**
- 验证姿势：用能通 Google 的浏览器看 GA4 **实时报表**（标准报表有 24-48h 延迟）+ DebugView。
  排查顺序：浏览器插件（uBlock/AdGuard 默认拦 GA）→ 代理分流规则 → 报表延迟 → 数据只从部署后产生。

---

## CMS / OAuth（Decap）
`/admin/` 是 **Decap CMS**（`public/admin/`，静态托管不走 Astro 路由），登录 `/api/auth` → `/api/callback`。
✅ `GITHUB_CLIENT_SECRET` 已配置。✅ 常驻校验 `npm run test:cms`。
- ⚠️ **Decap 保存时整份重写 JSON：未在 `config.yml` 声明的字段被静默丢弃**（曾因此抹掉 4 个 metrics）。
  **改 config.yml 前先对照真实 JSON 字段。**
- ⚠️ 写校验脚本的坑：**file collection 的根字段只是包裹层**，名字**不属于** item 字段路径
  （算成 `projects.name` 会让 64 个字段全误报）。**根字段有嵌套时，子字段用空前缀递归。**
- ⚠️ 三个隐患（**我没擅自改**，改错会弄挂 CMS）：`state` **从不校验**（无 CSRF）、
  `postMessage` **无 origin 白名单**、`client_id` 有**硬编码兜底**。

---

## ✅ 推送不需要 PAT（2026-09-11 纠正）
`git push` 直接能通（凭据已由 git-credential-manager 存好）。
`git -c http.proxy=http://127.0.0.1:$PORT -c https.proxy=http://127.0.0.1:$PORT push origin main`
- ⚠️ **代理端口每次开机都变**（见过 10265 → 29966 → 35372 → 10809），**先扫端口**。
- **推之前先 `fetch` + `merge`**（数据工作流每几小时推一次，直接推会被 `fetch first` 拒掉）。
  **用 merge，永不用 rebase。**
- ⚠️ **别再说"我推不了、请给 PAT"** —— 那是过期结论。

---

## 📊 SEO / 内容审计（2026-09-11）
**完整报告与全部实测数字在 `CryptoNav-SEO审计-2026-09-11.md`**；复现：`node scripts/audit-content.mjs`。
110 个真实内容页（剔除 `/embed/*` 与 `/admin/`）。**结论：技术上干净，但结构上无法积累权重。**

1. **商业页最薄**（投入与商业价值倒挂）：`/category/*` 中位 **371** 词（最薄 290）vs `/learn/*` **1378**。
2. **第一方经验信号为 0**：`/category/*` 0/10、`/compare/*` 0/6、`/chain/*` 0/10、`/learn/*` 0/9
   （唯一命中的 `/verify/*` 63/64 是功能 UI 模板句，不是内容）。YMYL 站点上这是最可行动的单项。
3. **正文内链被导航淹没**：每页固定 **72** 条 chrome 内链；`/compare/binance-vs-coinbase` 正文仅 **2** 条
   （**97%** 是导航）→ 内链图扁平，商业页是死胡同。
4. **`/chain/ton/` 是彻底孤儿页**（全站 0 入链），根因是**同一个 `slice(0, 8)` 写在两处**：
   `Header.astro:5`（sui/ton 无导航入链）**和** `chain/[slug].astro:21`
   （`filter(id!==self).slice(0,8)` 使 ton 不在任何页面列表里；sui 靠前 8 条链页的
   "Explore Other Chains" 拿到 8 条入链）。**`chains.json` 有 10 条，尾部两项必然不可达。2 行可修。**

⚠️ **报中位数前先确认分母**：我第一版把 64 个 `/embed/*` 徽章（17 词/2KB）算进去，
得出"内容/标记比中位 8.9"和"66 个零入链页"两个**错误结论**。徽章是 noindex iframe，
**本来就不该被链接**。`scripts/audit-content.mjs` 现在把 `/embed/*` 与 `/admin/` 作为显式常量排除。
其余：链页 **328KB / 1372 词**（标签 295KB、正文 33KB，97 个 img 带 `width=` 的 **0** 个）·
robots.txt 通配组出现 **2** 次、`Amazonbot` 一个 Disallow 一个 Allow。

⚠️ **HTML 恒 `cf-cache-status: DYNAMIC` 不是 bug，也不建议修**：`_routes.json` 已把 Functions 限制在
`/api/*`，请求**没进 compute**，只是没走边缘 HTML 缓存（CF 默认不缓存 HTML）。想变 `HIT` 要加
Cache Rule，代价是按 `s-maxage=86400` 缓存 24h，而本站数据 **6 小时**刷新 → **会发布过期数据**。

