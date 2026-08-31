# CryptoNav 待办操作手册

> 代码侧已经做完，全部推送到 GitHub `main`（HEAD = `5213991`）。
> 下面 6 件事必须在 **Cloudflare 后台 / 交易所后台 / Google 后台** 手工操作，我无法代劳。
> 按优先级排序，**第 0 项不做，后面 5 项全白做**——因为线上跑的还是旧版本。

**最近核对时间：2026-08-29 14:45**

---

## 目录

| 优先级 | 事项 | 预计耗时 | 做完后得到什么 |
|--------|------|----------|----------------|
| **P0** | 修复 Cloudflare Pages 部署（落后 3 个提交） | 10 分钟 | 63 个 `/verify/*` 页面上線 + 全部 SEO 改动生效 |
| **P1** | 填 8 个联盟码 | 60–90 分钟 | 8 家交易所的外链从"假链接"变成真正赚钱的返佣链接 |
| **P1** | 配置 Newsletter 环境变量 | 15 分钟 | `/api/subscribe` 从 503 变 200，开始收邮箱 |
| **P2** | Cloudflare Cache Rule | 5 分钟 | 边缘缓存生效，TTFB 下降，爬虫抓取配额消耗减少 |
| **P2** | GSC 重新提交 sitemap | 3 分钟 | Google 重新发现 174 个页面 |
| **P3** | AI 爬虫策略（需你先决策） | 5 分钟 | 决定是否在 AI 答案引擎里被引用 |

---

# P0 · 修复 Cloudflare Pages 部署（**必须先做**）

> **2026-08-31 更新：根因已定位并修复，代码已推送（`9885cd4`）。**
> 见下面「根因（已定位）」。这一节剩下的操作步骤仍然有用 —— 用来确认新的部署是否真的跑起来了。

## 根因（已定位）

报错是：

```
Failed: an internal error occurred. If this continues, contact support
Error: Failed to publish assets.
```

**构建是成功的，只有"发布资源"这一步失败。** 所以本地 `npm run build` 永远全绿，
问题只能出在产物本身。

真正的原因在 `public/logos/dex/`：

- `scripts/fetch_dex_wins.py` 每天下载 DexScreener 涨幅榜代币的 header 图，
  只判断了下限 `len(img) > 200`，**没有上限**；
- 这些 header 图很多其实是**动画 GIF**（文件头是 `GIF89a`），却被一律存成 `.png`，
  单个"代币图标"最大 **7.46 MB**；
- 而且**从来不删旧文件**。每天多几个，攒到 **106 个文件 / 45 MB**，
  而 `wins.json` 只引用其中 **7 个** —— 另外 99 个是没人用的孤儿。

`dist` 因此涨到 **67 MB / 695 个文件**。

已做的修复：

| 改动 | 说明 |
|------|------|
| 清理垃圾 | 删掉孤儿 + 超限文件，`dist` **67 MB → 21 MB** |
| `scripts/prune-dex-logos.py`（新） | 幂等清理脚本，删孤儿、删超限、并同步清空 `wins.json` 里的引用（UI 会退回首字母兜底，不会出坏图）。支持 `--dry` 预览 |
| `fetch_dex_wins.py` | 按魔数判断真实图片格式（不再一律存 `.png`）；下载上限 200 KB；每次采集后自动清理旧 logo |
| `refresh-wins.yml` | 加一道 prune 步骤，即使采集中途失败也不留垃圾 |
| `scripts/check-dist-size.mjs`（新） | 产物体积门禁（总 40 MB / 单文件 20 MB / 5000 文件），已接进 `npm test` |

**这次故障完全是静默的** —— 没有任何检查会去看产物有多大。体积门禁就是为了让它下次不再静默。

## 问题是什么

代码在 GitHub 上，但**线上网站跑的是至少 3 个提交之前的旧版本**。

我实测的证据（你可以自己复现，Windows 终端里粘贴即可）：

```bash
# 1. 线上首页的标题 —— 这是旧版标题
curl -s https://cryptonav.site/ | findstr "<title>"
# 实际输出：CryptoNav - Crypto Directory | Exchanges, Wallets, DeFi, NFT Navigator
# 本地代码现在是：CryptoNav — Crypto Directory: Exchanges, Wallets & DeFi

# 2. 线上首页完全没有 verify 相关字样
curl -s https://cryptonav.site/ | findstr /I "verify"
# 实际输出：（空）

# 3. /verify 系列页面全部 404
curl -s -o /dev/null -w "%{http_code}\n" https://cryptonav.site/verify/
curl -s -o /dev/null -w "%{http_code}\n" https://cryptonav.site/verify/binance/
# 实际输出：404 / 404
```

而本地仓库状态是完全干净的：

```
5213991  fix: replace coverage cap with shrinkage; 33-way tie at 75   ← HEAD
f46bede  feat: SEO metadata gate and per-page titles/descriptions
180c73b  feat: safety verification pipeline and /verify pages
2e624fa  docs: site audit, competitor landscape and growth strategy
```

`origin/main` = `5213991`，和本地一致。**代码推上去了，只是没构建、没部署。**

## 为什么这件事要紧

这 3 个提交里包含：

- **63 个 `/verify/*` 安全评测页**（`Is Binance Safe?` `Is Uniswap Safe?` …）——这是整个突围策略的核心，也是唯一能和 CoinGecko / CMC 拉开差异的内容。现在线上一个都没有。
- **63 个项目的公开安全核验数据**（域名年龄 + 被黑历史 + 合约风险），首页的 "Verified, not just listed" 板块也没上线。
- **全站 111 个可索引页面的 title/description 重写**（之前 67 处不合规，其中有 6 个页面共用同一段 description）。
- **安全评分模型的修复**（之前 33 个项目并列 75 分，等于评分没有区分度）。

换句话说：**最近两手的所有工作，用户一个字都看不到。**

## 操作步骤

### 第 1 步：打开部署列表

1. 浏览器打开 <https://dash.cloudflare.com/>
2. 左侧菜单 **Workers & Pages**
3. 点进 **`cryptonav`** 这个项目
4. 点顶部 **Deployments** 标签页

### 第 2 步：看最新一条记录的状态

列表里每一行会显示 **commit hash** 和 **状态**。你会看到以下三种情况之一：

---

**情况 A：列表里最新的 commit 是 `180c73b` 或更旧，`5213991` / `f46bede` 根本没出现**

> 诊断：自动部署没有触发。通常是 Pages 项目**没连上 Git**，或者**生产分支**设置不对。

处理：

1. 点 **Settings** → **Builds & deployments**
2. 看 **Branch deployments / Production branch** 这一项，确认生产分支是 **`main`**（不是 `master`、不是 `production`）
3. 往上看有没有 **"Connect to Git"** 的提示。如果显示 "Not connected"，点它重新授权 GitHub，选择 `Chris123564s/cryptonav`
4. 确认 **Build configurations**：
   - Framework preset: `Astro`
   - Build command: `npm run build`
   - Build output directory: `dist`
   - **Root directory**：留空（不要填 `/`）
5. 保存后回到 Deployments，点右上角 **Retry deployment** 或手动 **Create deployment**

---

**情况 B：有 `f46bede` 或 `5213991` 的记录，但状态是 `Failed` 或 `Error`**

> 诊断：构建失败了。老版本继续在线上跑，所以你看不到任何变化。

处理：

1. 点那条失败记录 → 点 **View build log**
2. 翻到日志最后 30 行，找红色的报错信息
3. 最常见的三种报错和对应解法：

| 报错关键词 | 原因 | 解法 |
|-----------|------|------|
| `Node.js version` / `EBADENGINE` | Pages 默认 Node 版本太旧 | Settings → Environment variables → 加一条 `NODE_VERSION` = `22.13.0`（**Build time 和 Runtime 都勾上**），保存后 Retry |
| `Cannot find module` / `npm ERR!` | 依赖没装全 | 删掉 `package-lock.json` 重新 `npm install` 提交一遍；或直接在日志里看具体是哪个包 |
| `Command failed: npm run build` 且上面有 `error during build` | 代码构建错误 | **把完整的报错信息复制给我**，我来修 |

4. 改完后点 **Retry deployment**

> 补充：如果日志里出现 `sh: 1: astro: not found`，说明 `npm ci` 阶段就没跑成功，优先按第 1 行 `NODE_VERSION` 处理。

---

**情况 C：最新记录状态是 `Success`，但线上还是旧内容**

> 诊断：构建成功了，但**缓存**没刷新。

处理：

1. 在 Deployments 列表里，确认最新一条右侧有 **"Active"** 的绿色标记。如果没有（比如标记在旧的那条上），点新记录右上角的 **`...` → Promote to production**
2. 然后清一次缓存（见下面 P2 的 Cache Rule 那节，或直接：Caching → Configuration → **Purge Everything**）
3. 等 1 分钟，重新跑第 3 步的验证命令

---

### 第 3 步：验证是否成功

在终端里跑（**三条都要过**）：

```bash
# 期望：看到新标题
curl -s https://cryptonav.site/ | findstr "<title>"
# ✅ 期望输出：<title>CryptoNav — Crypto Directory: Exchanges, Wallets &amp; DeFi</title>

# 期望：200，且页面里有 "Verified"
curl -s -o /dev/null -w "%{http_code}\n" https://cryptonav.site/verify/
curl -s https://cryptonav.site/ | findstr /I "verify"
# ✅ 期望输出：200 / 有匹配行

# 期望：200（Binance 的安全评测页）
curl -s -o /dev/null -w "%{http_code}\n" https://cryptonav.site/verify/binance/
# ✅ 期望输出：200
```

三条全绿，P0 才算完成。**做完这个再往下看。**

### 第 4 步（可选但推荐）：确认 GitHub Actions 也在跑

打开 <https://github.com/Chris123564s/cryptonav/actions>

里面有 5 个定时工作流：`refresh-safety` / `refresh-tokens` / `refresh-airdrops` / `refresh-unlocks` / `refresh-wins`。

- 如果全是灰色的 "never run"：说明工作流没启动。点进去手动 **Run workflow** 一次。
- 如果有红色的失败：点进去看日志，把报错发我。

---

# P1 · 填写 8 个联盟返佣码

## 问题是什么

`src/data/affiliates.json` 里 8 家交易所的 `code` **全是空字符串**：

```json
"binance":  { "code": "", "template": "https://www.binance.com/en/register?ref={code}" },
"okx":      { "code": "", "template": "https://www.okx.com/join/{code}" },
"bybit":    { "code": "", "template": "https://www.bybit.com/register?ref={code}" },
"coinbase": { "code": "", "template": "https://www.coinbase.com/join/{code}" },
"kraken":   { "code": "", "template": "https://www.kraken.com/signup?referral={code}" },
"gate-io":  { "code": "", "template": "https://www.gate.io/signup/{code}" },
"bitget":   { "code": "", "template": "https://www.bitget.com/referral/{code}" },
"mexc":     { "code": "", "template": "https://www.mexc.com/register?refCode={code}" }
```

`code` 为空时，代码会回退到 `projects.json` 里的 `referral` 字段，而那 8 条 referral **全是我当初写的占位假码**：

```
https://www.binance.com/en/register?ref=Cryptonav
https://www.okx.com/join/Cryptonav
https://www.bybit.com/register?ref=Cryptonav
https://www.coinbase.com/join/Cryptonav
https://www.kraken.com/signup?ref=Cryptonav
https://www.gate.io/signup/Cryptonav
https://www.bitget.com/referral/Cryptonav
https://www.mexc.com/register?refCode=Cryptonav
```

`Cryptonav` 这个码在任何一家交易所都不存在。

**后果**：网站上有 8 个位置（首页精选轮播、项目卡片、分类页、链页、`/verify/[slug]` 页底部 CTA、以及 8 个广告位）都在往外发这 8 条链接。用户点了、注册了、交易了 —— **你一分钱拿不到，还白送了流量。**

## 怎么拿到真实的联盟码

> ⚠️ **诚实说明**：我尝试直接抓取 8 家交易所的联盟计划页面来给你准确的申请网址，但 Binance 返回了错误页、OKX 连接失败、Bybit 被重定向到首页（都是反爬机制）。所以我**不给你我没验证过的网址**。
>
> 下面给的是**在交易所账户内部的操作路径**，这个不会因为反爬或改版而失效。请按路径走，别用第三方博客给的链接。

### 通用流程（8 家都一样）

1. **登录**该交易所（必须先完成 KYC 实名认证，绝大多数联盟计划都要求）
2. 找**邀请 / 推荐 / Affiliate** 入口
3. 生成你的专属链接或邀请码
4. **只把链接里的那段码复制出来**，填进 `affiliates.json`

### 各家的入口路径

| 交易所 | 账户内路径 | 注意 |
|--------|-----------|------|
| **Binance** | 头像 → **Referral**（推荐）→ 生成邀请链接。想拿更高佣金走头像 → **Affiliate Program** 单独申请 | ⚠️ 见下方「Binance 地区限制」 |
| **OKX** | 头像 → **Referral / 邀请好友** → 生成链接 | 标准返佣通常直接开通 |
| **Bybit** | 头像 → **Affiliate Program / 邀请有奖** → 生成 | 分"普通邀请"和"联盟"两档，佣金差很多，选联盟 |
| **Coinbase** | 站内只有 "Invite friends"（一次性奖励，不是持续佣金）。持续佣金需要单独申请 **Coinbase Affiliate Program**（走第三方联盟平台 Impact.com） | 门槛最高，可能需要网站流量证明。**可以先跳过** |
| **Kraken** | 站内邀请入口给的也是一次性奖励。持续佣金走 **Kraken Affiliate Program**，同样托管在第三方联盟平台 | 同上，**可以先跳过** |
| **Gate.io** | 头像 → **Affiliate Program / 联盟** → 申请 → 通过后生成 | 通常要求 KYC + 一定的社区影响力，申请会人工审核 |
| **Bitget** | 头像 → **Affiliate / 邀请** → 生成 | 审核较松，通过快 |
| **MEXC** | 头像 → **Affiliate Program / 推荐返佣** → 生成 | 审核较松 |

### ⚠️ Binance 地区限制（重要）

我在搜索时看到多个来源提到：**Binance 自 2026-07-01 起因 MiCA 法规，暂停了 EEA（欧洲经济区）注册用户参与推荐计划**，英国及部分亚洲、中东地区也有限制。

这个信息来自第三方站点，**我没能从 Binance 官方页面确认**。所以：

- 如果你的 Binance 账户注册地在欧洲/英国，**登录后在 Referral 页面自行确认**是否还能生成邀请码
- 如果确实被限制：**优先把精力放在 OKX / Bybit / Bitget / MEXC 这 4 家**，它们审核松、覆盖地区广，实际收益不会比 Binance 差多少

### 建议的执行顺序（不要 8 家一起搞）

考虑到审核时间和你的精力，我建议分两批：

**第一批（今天做，1 小时内能拿全）—— 审核松、立刻生效：**
1. **OKX** 2. **Bybit** 3. **Bitget** 4. **MEXC** 5. **Gate.io**

**第二批（这周内做）—— 佣金高但门槛高：**
6. **Binance**（先确认地区是否允许）7. **Coinbase** 8. **Kraken**

> 先跑通第一批 5 家，网站就有真实收入了。剩下 3 家慢慢来。

## 填到哪里

拿到码之后，**两种方式任选**：

### 方式 A：你自己改文件（推荐，最快）

打开 `src/data/affiliates.json`，把 `code` 填进去：

```json
{
  "exchanges": {
    "binance":  { "code": "你的BINANCE码", "template": "https://www.binance.com/en/register?ref={code}" },
    "okx":      { "code": "你的OKX码",     "template": "https://www.okx.com/join/{code}" },
    "bybit":    { "code": "你的BYBIT码",   "template": "https://www.bybit.com/register?ref={code}" },
    "coinbase": { "code": "",              "template": "https://www.coinbase.com/join/{code}" },
    "kraken":   { "code": "",              "template": "https://www.kraken.com/signup?referral={code}" },
    "gate-io":  { "code": "你的GATE码",    "template": "https://www.gate.io/signup/{code}" },
    "bitget":   { "code": "你的BITGET码",  "template": "https://www.bitget.com/referral/{code}" },
    "mexc":     { "code": "你的MEXC码",    "template": "https://www.mexc.com/register?refCode={code}" }
  }
}
```

然后提交推送：

```bash
git add src/data/affiliates.json
git commit -m "chore: fill in real affiliate codes"
git push
```

**这个文件是唯一需要改的地方** —— 8 个广告位、项目卡片、链页、`/verify` 页的 CTA 全部会自动用上新链接，一处改动全站生效。

### 方式 B：把码发给我

直接把 8 个码贴给我（或只贴你拿到的那几个），我来填、我来提交推送。

### 验证

推送部署完成后：

```bash
curl -s https://cryptonav.site/verify/binance/ | findstr /I "binance.com/en/register"
```

看输出的链接里 `ref=` 后面是不是你的真实码，**不应该再是 `Cryptonav`**。

---

# P1 · 配置 Newsletter 环境变量

## 问题是什么

首页和 `/learn` 页都有邮箱订阅框，但现在提交会失败：

```bash
curl -s -X POST -H "Content-Type: application/json" ^
  -d "{\"email\":\"test@example.com\"}" https://cryptonav.site/api/subscribe
```

实际返回：

```json
{"ok":false,"error":"Newsletter is not configured yet.","unconfigured":true}
```

HTTP 状态码 **503**。

**后果**：每个输入邮箱的用户都订阅失败。这是全站转化率最高的一个转化点，目前 100% 流失。

## 操作步骤

### 第 1 步：先选一个邮件服务商

代码支持三种模式（`/functions/api/subscribe.js` 里实现的）：

| `NEWSLETTER_PROVIDER` 值 | 适用服务 | 说明 |
|--------------------------|----------|------|
| `generic`（默认） | 任何接受 JSON POST 的服务 | 最通用 |
| `mailchimp` | Mailchimp | 用 Basic 认证 |
| `buttondown` | Buttondown | 用 Token 认证 |

**我的建议：用 Buttondown。** 理由：专为 Newsletter 设计、有免费档（前 100 订阅者免费）、API 极简、不需要像 Mailchimp 那样配 Audience ID/Datacenter 前缀。

Buttondown 注册：<https://buttondown.com/> → 注册 → Settings → API → 拿到 API Key，和你的接口地址。

### 第 2 步：在 Cloudflare 里填环境变量

1. <https://dash.cloudflare.com/> → **Workers & Pages** → **`cryptonav`**
2. **Settings** → **Environment variables** → **Add variable**

逐条添加（**注意大小写必须完全一致**）：

| 变量名 | 值 | 类型 |
|--------|-----|------|
| `NEWSLETTER_PROVIDER` | `buttondown`（或 `generic` / `mailchimp`） | 普通文本 |
| `NEWSLETTER_ENDPOINT` | 你的订阅接口 URL，**必填**，不填就一直是 503 | 普通文本 |
| `NEWSLETTER_TOKEN` | 你的 API Key | ⚠️ **点 Encrypt 加密** |

三条都要**同时勾选 "Production" 和 "Preview"**。

> `NEWSLETTER_TOKEN` 一定要点 **Encrypt**。加密后 Cloudflare 界面上就再也看不到明文了，改不了也读不出来 —— 填之前先确认 Key 复制对了。

### 第 3 步：重新部署

**环境变量改完不会自动生效，必须重新部署一次才会带上新变量。**

Deployments → 最新一条 → **`...` → Retry deployment**

（正好可以顺便把 P0 一起做了。）

### 第 4 步：验证

```bash
curl -s -X POST -H "Content-Type: application/json" ^
  -d "{\"email\":\"你的真实邮箱@example.com\"}" https://cryptonav.site/api/subscribe
```

✅ 期望：`{"ok":true,...}`，并且去 Buttondown 后台能看到这个订阅者。
❌ 如果还是 503：变量没填、名字拼错、或者没重新部署。

---

# P2 · Cloudflare Cache Rule（`_headers` 文件没生效）

## 问题是什么

项目里有 `public/_headers`，内容是对的：

```
/*
  Cache-Control: public, max-age=0, s-maxage=86400, stale-while-revalidate=604800
```

但实测线上响应头：

```bash
curl -s -D - -o /dev/null https://cryptonav.site/
```

```
cache-control: public, max-age=0, must-revalidate
cf-cache-status: DYNAMIC
```

`cf-cache-status: DYNAMIC` 意味着 **Cloudflare 认为这个响应不可缓存，每次都回源**。
`s-maxage=86400` 那条规则**没有生效**。

**后果**：

- 每个访客、每次刷新都要回源拿 HTML，TTFB 高
- **Googlebot 的抓取配额被白白浪费**——对一个 DA=0 的新站来说，抓取预算是最稀缺的资源之一
- 免费的 Pages 构建次数虽然不限请求，但回源延迟直接影响 Core Web Vitals，进而影响排名

## 操作步骤

手工在 Cloudflare 后台建一条 Cache Rule，`_headers` 就不用再管了：

1. <https://dash.cloudflare.com/> → 选中 **`cryptonav.site`** 这个域（**不是 Pages 项目**）
2. 左侧 **Caching** → **Cache Rules**
3. **Create rule**
4. 规则名填：`Cache static pages`
5. **如果进来的请求匹配…**：
   - 选 **Custom filter expression** → **Edit expression**
   - 粘贴下面这段（**排除 `/api/`，那部分是 Pages Function，必须动态**）：

   ```
   (http.host eq "cryptonav.site" and not http.request.uri.path starts_with "/api/")
   ```

   或者用向导模式：
   - Field: `Hostname` / Operator: `equals` / Value: `cryptonav.site`
   - **And**
   - Field: `URI Path` / Operator: `does not start with` / Value: `/api/`

6. **然后…** 设置：
   - **Cache eligibility** → 选 **Eligible for cache**
   - **Edge TTL** → 选 **Use cache-control header if present, use default otherwise**
     （或者直接选 **Ignore cache-control header and use this TTL** → `1 day`，更省事、更可控）
   - **Browser TTL** → `Respect origin TTL`
7. 点 **Deploy**

> 如果你之前没建过 Cache Rules，这个页面可能叫 "Caching → Configuration → Cache Rules"，位置一样。

## 验证

```bash
curl -s -D - -o /dev/null https://cryptonav.site/ | findstr /I "cf-cache-status"
```

- 第一次可能是 `MISS`（正常，缓存还没填）
- **再跑一次**，应该变成 `HIT` 或 `REVALIDATED`

✅ 看到 `HIT` 就成了。

---

# P2 · Google Search Console 重新提交 sitemap

## 为什么要做

站点从 27 个页面涨到了 **174 个页面**，新增了 63 个 `/verify/*` 安全评测页。Google 不会自己发现这些新页面，要主动告诉它。

## 操作步骤

1. 打开 <https://search.google.com/search-console>
2. 选中属性 **`cryptonav.site`**（如果还没验证过域名，先按提示加一条 DNS TXT 记录验证）
3. 左侧 **Sitemaps**
4. 如果 `sitemap-index.xml` 已经在列表里：
   - 点右侧 **`...` → 重新提交 / Resubmit**
   - 或者把 `sitemap-index.xml` 删掉再重新添加
5. 如果不在列表里：
   - 顶部输入框填 `sitemap-index.xml`（**只填路径，不要填完整 URL**）
   - 点 **提交**
6. 状态变成 **"Success"** 即可（可能需要几分钟到几小时刷新）

已确认这个地址是通的：

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://cryptonav.site/sitemap-index.xml
# 输出：200
```

## 顺手做一件事：请求索引

GSC 左侧 **网址检查（URL Inspection）**，把这几个页面逐个粘进去点 **请求编入索引**：

- `https://cryptonav.site/verify/` ← 最重要，这是评测页的入口
- `https://cryptonav.site/verify/binance/`
- `https://cryptonav.site/compare/binance-vs-coinbase/`
- `https://cryptonav.site/learn/`

每天最多手动提交 10 条左右，别一次全塞。

---

# P3 · AI 爬虫策略（需要你先决策）

## 现状

`public/robots.txt` 目前是空的策略：

```
User-agent: *
Allow: /

Sitemap: https://cryptonav.site/sitemap-index.xml
```

**没有任何 AI 爬虫相关的指令**。所以现在的实际效果是：所有 AI 爬虫默认都能抓（因为 `* / Allow: /`）。

## 我的建议：**保持允许，但关掉训练授权**

理由，针对你这个站的具体情况：

1. **`/verify/*` 页面天生适合被 AI 引用。** 用户在 Perplexity / ChatGPT 里问 "Is Binance safe?"，AI 需要引用一个带数据的第三方来源 —— 你的页面正好是这个形态（域名年龄 + 被黑历史 + 评分），而且**AI 引用时会带来源链接**，这是免费的高质量外链。
2. **你现在没有任何东西可失去。** 网站 DA=0、无自然流量。这种情况下"防止内容被白嫖"是伪命题 —— 你没有流量可以流失，而 AI 引用是少数几条能绕开"新站没有权重"的捷径。
3. **拒绝训练 ≠ 拒绝引用。** 这两件事现在可以分开设置。你可以允许 AI 读取并引用你的内容（带链接），同时拒绝用于模型训练。

**反面你要知道的**：允引意味着用户可能在 AI 回答里就拿到了答案，不再点进你的网站。对纯信息型内容这是真实损失。所以这是个权衡，不是免费午餐。

## 三个选项，你选一个

### 选项 A：全允许 + 拒绝训练（**我推荐这个**）

```
User-agent: *
Allow: /

# AI answer engines — allowed to read and cite with attribution
User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Google-Extended
Allow: /

Sitemap: https://cryptonav.site/sitemap-index.xml
```

然后在 Cloudflare 里把训练授权关掉（见下面"用 Cloudflare 一键开关"）。

### 选项 B：只允许 AI 搜索/引用型爬虫，挡掉训练型爬虫

和 A 的区别是不加 `GPTBot`（GPTBot 主要是训练用途），只留 `OAI-SearchBot`（ChatGPT 搜索引用）、`PerplexityBot`、`ClaudeBot`。

### 选项 C：全挡

```
User-agent: GPTBot
Disallow: /

User-agent: PerplexityBot
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: Google-Extended
Disallow: /
```

**我不建议这个**，但对目录型站点来说是可以理解的保守选择。

## 用 Cloudflare 一键开关（比改 robots.txt 更省事）

既然你已经在 Cloudflare 上，可以直接用它的原生功能，不用手写文件：

1. <https://dash.cloudflare.com/> → 选中 **`cryptonav.site`**
2. 左侧 **Bots** → 找 **AI Scrapers and Crawlers** 或 **AI Crawl Control**（Cloudflare 2025 年推出，入口名字改过几次，可能在 **Bots → AI Crawl Control** 或 **Caching → Content Signals**）
3. 里面有现成的开关：
   - **Block AI Scrapers and Crawlers** → 保持 **关闭**（即不挡）
   - **Content Signals** → 这里可以分别设置：
     - `search` = `yes`（允许搜索索引）← 必须开
     - `ai-input` = `yes`（允许 AI 读取并引用）← 建议开
     - `ai-train` = **`no`**（拒绝用于模型训练）← 建议关

这个比手写 robots.txt 更可靠，因为 Cloudflare 会同时输出 HTTP 响应头和 `/.well-known/content-signals-policy.json`，AI 厂商更认这个。

## 你只需要回我一句

> "AI 爬虫用选项 A / B / C"

我就把 `robots.txt` 改好提交。如果你选 A，我推荐你**只点 Cloudflare 后台的开关，不动 robots.txt**（现在的默认配置已经是"全允许"了）。

---

# 附：做完之后，还需要我做的

下面这些是我这边能继续推进的，等你的信号：

| 事项 | 说明 |
|------|------|
| **Wayback 在 CI 里是否可用** | 本地沙箱访问 `web.archive.org` 一直失败，导致 63 个项目的 `firstSeenAt` 全是 null。部署后在 GitHub Actions 里可能能通。如果通了，15 个"域名年龄置信度=low"的项目会自动补上真实上线时间 |
| **Blur 评分偏高** | `blur.io` 域名注册于 2013，但 Blur 项目 2022 年才上线。域名年龄维度因此虚高，拿到 98 分。需要人工加一条"项目实际成立时间"覆盖数据 |
| **`arkham` 合约数据缺失** | GoPlus 对 Arkham 返回 `no-result`，导致它的合约安全维度缺失。需要手工补或换数据源 |
| **`/chain/ton` 零内链** | 这个链页没有被任何其他页面链接到，是孤儿页。需要补内链 |
| **链页内容过载** | 链页塞的代币太多，页面体积大、主题不聚焦，建议精简 |
| **`/embed/[slug]` 徽章 BD** | 安全徽章的嵌入式页面已经做好了，可以主动去联系项目方，让他们把"已核验"徽章挂到自己官网上 —— 这既是外链也是品牌曝光 |

---

# 快速检查清单（打印用）

```
[ ] P0  Cloudflare Pages 部署修好
        [ ] Deployments 里看到 5213991 且状态 Success 且标记 Active
        [ ] curl /verify/ 返回 200
        [ ] curl /verify/binance/ 返回 200
        [ ] 首页 title 是新的（带 — 和 &）
        [ ] GitHub Actions 5 个工作流都能跑

[ ] P1  联盟码
        [ ] OKX      [ ] Bybit    [ ] Bitget
        [ ] MEXC     [ ] Gate.io
        [ ] Binance（先确认地区允许）[ ] Coinbase   [ ] Kraken
        [ ] 线上 /verify/binance/ 的链接里 ref= 不再是 Cryptonav

[ ] P1  Newsletter
        [ ] NEWSLETTER_PROVIDER / _ENDPOINT / _TOKEN 三条都填了
        [ ] TOKEN 点了 Encrypt
        [ ] Production + Preview 都勾了
        [ ] 重新部署过
        [ ] POST /api/subscribe 返回 ok:true

[ ] P2  Cache Rule
        [ ] 规则建好并 Deploy
        [ ] 第二次 curl 看到 cf-cache-status: HIT

[ ] P2  GSC
        [ ] sitemap 重新提交，状态 Success
        [ ] /verify/ 等 4 个页面请求了索引

[ ] P3  AI 爬虫
        [ ] 选定 A / B / C
        [ ] （若选 A）Cloudflare Content Signals 里把 ai-train 设为 no
```
