# CryptoNav 项目记忆

英文加密导航站（国际用户，绿涨红跌）。Astro + Tailwind + JSON + Cloudflare Pages；
仓库 `Chris123564s/cryptonav`（main）。工作目录 `C:\Users\a\WorkBuddy AI\2026-08-27-10-59-43`。
**只放"必须遵守的规则与结论"**；过程在 `memory/YYYY-MM-DD.md`，可复用流程在 `~/.workbuddy-ai/skills/`。
最后整理 2026-09-11。⚠️ **注入上限约 17.5 KB，超出静默截断** —— 增补前先删旧的。

---

## 🔴 待用户动作
1. **6 个联盟码**：okx / coinbase / kraken / gate-io / bitget / mexc —— `code` 是**空字符串**，
   发完整链接即可，34 处 promo 立刻变现。
2. **确认 GA4 数据流 URL 是否带 www**；并**修 `www.cryptonav.site` 的 522**（Redirect Rule）。
3. **关掉 Cloudflare Managed robots.txt**（后台开关）—— 平台层注入 `Amazonbot: Disallow: /`
   覆盖仓库里明确的 `Allow: /`；通配组 `Content-Signal` 有两套矛盾值。
4. **GA4 欧盟同意弹窗**（落点 `Layout.astro`）；5. **Bitmedia/Coinzilla 广告代码**（8 槽全空）；
   6. **SPF**：后台加 `v=spf1 include:spf.mail.qq.com ~all`（token 无 DNS 权限）。
7. Bybit 活动截止 `2026-10-04`（我猜的，待确认）。
8. **战略拍板**：商业页是否重写到 1200+ 词并加第一方经验（5 倍投入）。

**已修复、无需再跟**：`/api/submit` 构建 DoS；`/newsletter` 已下线。
**⚠️ 反转项**：**不要断开 CF Pages Git 集成**（旧待办，照做会静默停更 —— 见「部署」）。

---

## 联盟码写入原则
- **唯一边界：访客只接触官方域名。** 码的来源不影响访客安全。
- ✅ **可写**：用户给什么链接，就把 `template` 的**域名换成那个链接的域名**，`code` 填链接里的 ID。
- ❌ **不写**：来源不明、无法确认归属的野鸡域名（`bsmkweb.cc` 等）。
- ⚠️ **"域名必须官方" ≠ "必须是主域"**：`template` 只是拼接壳子，域名由用户给的链接决定。
  用户已明说 **"不要去参考模板了，以我的为准"** → **别家长式拦阻**，剩余风险只涉返佣归属。
- 现状：binance `GRO_28502_B2R17` ✅、bybit `166214` ✅；其余 6 家待填。

---

## 广告位机制
- 优先级：`ads.json 直投（active + 时间窗）> ad-network.json 的 html > promo > "Your Ad Here"`。
- ⚠️ **`weight` = "构建时被选中的概率"，不是展示概率**（Astro 静态生成，每页构建 `Math.random()`
  抽一次就固定）。要稳定展示某条，就让它成为该 slot 唯一候选。
- **`image` 填不填决定看不看得见文案**：填了只渲染 `<img>`（文字进 alt）；不填才走渐变+文字。
  **活动推广必须留空 image。**
- **RULE**：promo 的 `projectId` **必须是 affiliates.json 的 key**，否则 `getReferralUrl()` 无码可拼、
  只渲染他人官网，**永远不赚钱且页面上看不出区别**。
- ⚠️ **判断"有没有码"看 `code` 的值，不能只看 key 在不在**：8 家全是 key，只有 2 家 `code` 非空。
- 统计用 `scripts/check-ad-slots.mjs`（口径 `data-ad-id=`/`data-promo-project=`）；按"官网 URL 出现
  次数"统计**会被项目卡片链接污染**（曾虚高到 27/28）。
- 视觉：渐变用行内 CSS 变量 `--ad-1 / --ad-2 / --ad-glow`（配色表在 `AdBanner.astro`）。
  **改 `.ad-container` / `.ad-label` 必须用更高特异性** —— 它们在 `@layer components`
  （**Tailwind 的处理层，不是原生 cascade layer**），覆盖**不能靠加载顺序**。
- 现状：129 处渲染，**95/129 已能赚（74%）**。ad-006（Bybit）`endAt: 2026-10-04`，
  到期回落到 promo（正是 bybit，有码）→ **不会掉成不赚钱的位子**。

---

## ⚠️ 沙箱 safe-delete 守卫：一个根因，五个后果
阈值 **50 个文件**、`scope:"turn"`。触发后**该轮内一切删除都失败**（`rm`、`rm -rf`、
换 `--outDir` 建新目录都一样）。**`mv` 不算删除，可正常用。**
1. **本地构建到不了 `astro:build:done`**（在 `cleanServerOutput` 被抛异常中断）→
   `npm run build` 的 **exit=1 是假失败**（用 `grep -E "Complete"` 确认）。
2. **`dist/sitemap-0.xml` 本地永远生不出来** → **读 `dist/sitemap-*.xml` 的测试在本地都不可信**
   （CI 干净 runner 仍严格）。
3. **本地 `dist/` 不清空** → `grep -r ... dist/` 会读到上批旧文件，把"旧文案还在"误判成改动没生效。
   **先取 HTML 实际引用的资源名再只查这些**（`dist/**/*.html` 不匹配嵌套目录）。
4. **手动部署会把死文件传上去**（真要 `wrangler pages deploy` 先换干净目录）。
5. **`git` 自我维护本身就是批量删除** → 撞守卫 → **`.git` 被毁**。

**不影响线上**（CI 每次干净 runner）。**两次目录消失事故**：① `src/`（60 文件）→ `git checkout -- src/`；
② **`.git/refs/` + `objects/pack/*.pack` 全被删** → 恢复流程已固化为技能 **`recover-destroyed-git-repo`**
（reflog 是命根子；`refs/remotes/` 写入**不持久**，要用本地分支中转；`git fsck` 刷
`failed to load pack entry` = 僵尸 `.idx`，先移走）。**教训：做批量文件操作前先提交。**

⚠️ **Vite 过期缓存致构建崩溃**：`node_modules/.vite/deps_temp_*` 删不动 →
`TypeError: msg.includes is not a function`。**症状与代码改动无关，极具迷惑性。** 修复：`mv` 走。

---

## 实时行情架构
浏览器组件统一走 `src/utils/coingecko.ts` 的 `cgFetch()`：① 优先 `/api/cg/*`（Pages Function，
Cache API + 并发去重 + 24h 陈旧兜底）；② 边缘 429/5xx 时回退访客 IP 直连。
⚠️ **看缓存看 `X-CG-Cache`，不要看 `cf-cache-status`**（后者恒 DYNAMIC）。回归：`npm run test:cg`。

---

## 部署与 CI
- ✅ **保留 Wrangler，push 到 main 自动部署**（`deploy-pages.yml` + `workflow_dispatch`，
  concurrency 串行）。故意**不加 `paths-ignore`** —— 过滤会新增"推了却没部署"的静默失败类型。
- **CI 只跑 `npm ci && npm run build`，不跑 `npm test`** → 能阻断 CI 的只有**构建期**报错。
- `_routes.json` 必须同时有 `include` **和** `exclude` 两个数组（Wrangler 源码 `isRoutesJSONSpec()`
  要求都是数组；**云文档说 exclude 可选是错的**）。缺 exclude 曾让所有部署发布阶段被拒一整天，
  且 Pages 构建器只报含糊的 `Failed to publish assets`。校验 `scripts/check-routes-json.mjs`。
- **CI 警告纪律：健康流水线必须零警告。** 无法判断的检查只输出普通日志（`note()`），
  `::warning::` 只留给可行动项（`test-cloudflare-token.mjs` 断言**精确警告数**）。
- ⭐ **`GITHUB_TOKEN` 推送不触发其他工作流**（GitHub 防递归）。5 个数据工作流全用
  `secrets.GITHUB_TOKEN` → **它们推的提交不跑 `deploy-pages.yml`**，只有 CF Git 集成在构建。
  真人推送 → workflow **＋** Git 集成（**两遍**）；机器人推送 → **只有 Git 集成**。
  （证据：近 12 天逐日比对 11/12 吻合；9-07~9-10 机器人 29 / 真人 0 → 部署 **0** 次。）
- 🔴 **绝对不要断开 CF Pages Git 集成** —— 断掉后机器人推送既不触发 workflow、又没了 Git 集成，
  **没有任何东西会构建它，而且不报错**（站点看着正常、数据一天天变旧，最难发现的故障）。
  **推荐**：Git 集成不动；想省真人推送的两遍构建，就删 `deploy-pages.yml` 或去掉其 `push:` 触发。
  要 Wrangler 当唯一通道：先把 5 个数据工作流的 checkout token 换成 PAT。
- **额度**：近 30 天本 workflow 只跑 **46 次（9.2%）**，含 Git 集成合计约 **50-56%** →
  **"逼近上限"作废**。构建额度**按 push 次数算，不按 commit 数**。

---

## 链接健康巡检
`.github/workflows/check-links.yml`（周二 04:00 UTC，crawl + outbound 合并在一个文件 ——
推 `.github/workflows/` 需 PAT 的 `workflow` scope）。crawl：110 URL / **0 死链**；outbound：63 个官网。
- **只有「确认失效」才让 job 变红**。63 个里 18 个会挡数据中心 IP 返 403，算失效就每周报红 →
  被当噪音忽略 → 淹没真问题。
- 脚本用 **`process.exitCode`，禁用 `process.exit()`**（后者污染 Node/Windows 退出码）。
- ⚠️ **6 个跨域名重定向都不要改**（理由见 `scripts/known-redirects.json`）：改了会制造 blur 式评分污染；
  Magic Eden 必须保留 `.io`。

---

## 写入端点 `/api/submit`（BD 入口）
- 调 GitHub API 把提交**直接写进 `src/data/projects.json`**（`status: 'pending'`）。`GITHUB_ISSUE_TOKEN` ✅。
- ⚠️ **探测它有副作用**：真 POST 一次会**在 main 上创建提交**并**触发一次部署**。**别当无副作用的健康检查。**
- ✅ **安全**：字段白名单让访客**无法**设置 `status/sponsored/verified/featured/riskLevel/source`
  → 提交必然是 `pending`，`getActiveProjects()` 只取 `active`。
- 教训：前端**原样打印后端 `error` 字段** → 后端文案 = 访客可见文案。
  ⚠️ **别用"线上返回什么"推断变量配没配** —— 容易把"代码没上线"误读成"变量没配"。
- 加固（`scripts/test-submit.mjs`）：字段长度上限；website 必须 http(s)（否则 `javascript:`
  会存下来，批准后渲染成 `<a href>` 就是可点击 XSS）；控制字符剥离。

### 🔴🔴 曾存在的构建 DoS（已修，2026-09-11）
`src/pages/verify/[slug].astro` 的 `getStaticPaths` 原本遍历**全部** projects + `if (!s) throw`；
而 `/api/submit` 追加的 `pending` 条目**没有**安全记录 → 构建中断，**坏条目留在 JSON 里 →
之后每一次构建都失败**，CF 继续服务上一个好版本 → **站点不挂、不报错、静默停更**。
**一发匿名请求即可让后续所有部署永久失败。** 这是 2026-09-06 部署失败（`86f8ee6`）的真因。
**修复**：`verify/[slug].astro` 与 `embed/[slug].astro` 改用 `getActiveProjects()`；
**那个 `throw` 故意保留**。`check-safety.mjs` 断言口径同步改 active，并**新增源码级守卫**
（读两个 `.astro` 的 `getStaticPaths` 块，要求含 `getActiveProjects()` 且不含 `projects.map`）
——**注释拦不住人，测试可以**。

---

## 🔕 Newsletter 已整块下线（用户拍板）
订阅框、页脚链接、`/newsletter`、`SubscribeForm`、advertise 页 Sponsor 位全移除。
**恢复：`git revert` 那两个提交**；`/api/subscribe` 后端保留，Supabase SQL 在 `supabase/`。
⚠️ 若重启用：列名与 payload **逐字一致** `{email, source, subscribedAt, site}`（`subscribedAt`
**必须带双引号建列**），**重复邮箱不能返回 409** —— 两条都是 `subscribe.js` 把**上游 400 当成功**
逼出来的，违反任一条就**静默丢数据**。

---

## 统计代码
**GA4 `G-MD66BHJN9Y`**（`Layout.astro` head，`import.meta.env.PROD` 包裹，设 `_ga` cookie）
+ **Cloudflare Web Analytics**（body 末尾，无 cookie）。
- ⚠️ **改任何一个都要同步 `src/pages/privacy.astro`**；`check-meta.mjs` 断言非 noindex 页必须带 GA4 标签。
- ⚠️ **合规缺口（未解决）**：GA4 在欧盟属需事先同意，站上**没有同意弹窗**。

### ⭐ 「GA4 检测不到」：三件独立的事，别混为一谈（2026-09-11）
- **后台报"未检测到 Google 代码"** → **标签只活了 1~1.5 小时**（11:09 提交、11:16-11:49 上线）。
  GA4 检测是**周期性爬虫**，Google 说最多 48h 才更新 → **先等，再用实时报表验证**。
- **用户自己看不到数据** → 网络到不了 Google（见下）。
- **标签本身 100% 正确**：在 `<head>`、文档 4.3% 处、抽查 6 个页面族全在、canonical 指向 apex。
- 🔴 **本机代理主动屏蔽 GA 域名**：`fonts.googleapis.com` → 200，但 `googletagmanager.com` /
  `google-analytics.com` → **000**。→ **这台机器上跑任何 GA 探针都得不出结论**；
  `collectRequests: 0` 是本机网络的产物，**不是标签坏了**。
  **上一轮"挂代理 collect=204"不可复现，已作废。** `check-ga-live.mjs` 已加对照探测输出
  `verdict: INCONCLUSIVE`，不再误导。
- ⚠️ **`window.gtag` / `dataLayer.length` 证明不了任何事**（由我们自己的内联片段定义）。
  **只有 `collectRequests` 和 `_ga` cookie 是真信号。** Chrome 不读 `https_proxy`，必须 `--proxy-server=`。
- 🔴 **`www.cryptonav.site` 返回 522**（DNS 有记录但没挂到 Pages）→ 若 GA4 数据流 URL 填的是带 www 的，
  检测器抓到的就是错误页。**修：CF Redirect Rule，`www.cryptonav.site/*` → `https://cryptonav.site/$1`（301）。**
- ⚠️ `cryptonav.pages.dev` 是**别人的中文站**。验证姿势：用能通 Google 的浏览器打开站点 →
  GA4 **实时报表** + DebugView。

---

## CMS / OAuth（Decap）
`/admin/` 是 **Decap CMS**（`public/admin/`，静态托管不走 Astro 路由），`/api/auth` → `/api/callback`。
✅ `GITHUB_CLIENT_SECRET` 已配置。✅ 常驻校验 `npm run test:cms`。
- ⚠️ **Decap 保存时整份重写 JSON：未在 `config.yml` 声明的字段被静默丢弃**（曾抹掉 4 个 metrics）。
  **改 config.yml 前先对照真实 JSON 字段。**
- ⚠️ 校验脚本的坑：**file collection 的根字段只是包裹层**，名字**不属于** item 字段路径
  （算成 `projects.name` 会让 64 个字段全误报）。**根字段有嵌套时，子字段用空前缀递归。**
- ⚠️ 三个隐患（**我没擅自改**，改错会弄挂 CMS）：`state` **从不校验**（无 CSRF）、
  `postMessage` **无 origin 白名单**、`client_id` 有**硬编码兜底**。

---

## ✅ 推送不需要 PAT，但必须绕过 helper-selector（2026-09-11）
凭据由 git-credential-manager 存好，**不需要 PAT**。但 `push` 会**偶发挂死**（零输出、无报错）。
`GIT_TRACE=1` 显示卡在 **`git-credential-helper-sel`** —— PortableGit 的**系统级**
`credential.helper=helper-selector` 垫片。**不是网络，也不是 pack-objects**（旧归因是错的）。

```bash
git -c credential.helper= -c credential.helper=manager \
    -c http.proxy=http://127.0.0.1:$PORT -c https.proxy=http://127.0.0.1:$PORT \
    push origin main
```

诊断一行（应**立刻**返回；卡住就是垫片的问题）：
`printf 'protocol=https\nhost=github.com\n\n' | git -c credential.helper= -c credential.helper=manager credential fill`

- ⚠️ **代理端口每次开机都变**（10265 → 29966 → 35372 → 10809），**先扫端口**。
- **推之前先 `fetch` + `merge`**（数据工作流每几小时推一次，直接推会被 `fetch first` 拒掉）。
  **用 merge，永不用 rebase。**
- ⚠️ **别再说"我推不了、请给 PAT"** —— 过期结论。

---

## 📊 SEO / 内容审计（2026-09-11）
**实测数字在 `CryptoNav-SEO审计-2026-09-11.md`**；复现：`node scripts/audit-content.mjs`。
110 个真实内容页（剔除 `/embed/*` 与 `/admin/`）。**结论：技术上干净，但结构上无法积累权重。**
1. **商业页最薄**：`/category/*` 中位 **371** 词（最薄 290）vs `/learn/*` **1378** —— 投入与商业价值倒挂。
2. **第一方经验信号 = 0**：`/category/*` 0/10、`/compare/*` 0/6、`/chain/*` 0/10、`/learn/*` 0/9
   （`/verify/*` 63/64 是功能 UI 模板句，不是内容）。YMYL 站点上这是最可行动的单项。
3. **正文内链被导航淹没**：每页固定 **72** 条 chrome 内链；`/compare/binance-vs-coinbase` 正文仅 **2** 条
   （**97%** 是导航）→ 内链图扁平，商业页是死胡同。
4. **`/chain/ton/` 是彻底孤儿页**（全站 0 入链）。根因：**同一个 `slice(0, 8)` 写在两处** ——
   `Header.astro:5` 与 `chain/[slug].astro:21`（`filter(id!==self).slice(0,8)`）。
   **`chains.json` 有 10 条，尾部必然不可达。2 行可修。**

⚠️ **报中位数前先确认分母**：我第一版把 64 个 `/embed/*` 徽章（17 词/2KB）算进去，得出
"内容/标记比中位 8.9""66 个零入链页"两个**错误结论**。徽章是 noindex iframe，本就不该被链接。
