# GA4「未在您的网站上检测到 Google 代码」— 排查与修复

**日期**：2026-09-11 · **测量 ID**：`G-MD66BHJN9Y`
**结论：这是三件独立的事被混成了一件。标签代码本身没有任何问题。**

---

## 一、标签是对的（四种方式验证过）

| 检查 | 结果 |
|---|---|
| 线上**原始 HTML**（GA4 检测器就是这么抓的，不执行 JS） | ✅ `<head>` 内、文档 **4.3%** 处 |
| 标签形态 | ✅ 标准 `<script async src="https://www.googletagmanager.com/gtag/js?id=G-MD66BHJN9Y">` + 内联 `gtag('config', …)` |
| 抽查 6 个页面族（`/`、`/learn/`、`/category/defi/`、`/chain/ethereum/`、`/compare/binance-vs-coinbase/`、`/dashboard/`） | ✅ **每页 2 处，全在** |
| `canonical` / `og:url` | ✅ 都指向 `https://cryptonav.site/`（apex，正确） |
| 用 Googlebot UA、空 UA 抓取 | ✅ 均 200 且带标签，**Cloudflare 没有拦爬虫**，无 `cf-mitigated` 挑战头 |

**所以：不要改代码。** 改代码不会让这条提示消失。

---

## 二、最可能的原因：标签只活了 1~1.5 小时

- GA4 提交 `4759db7 feat(analytics): add GA4` 时间：**11:09**
- 实际部署上线：**11:16–11:49**
- 你看到这条提示：**12:49**

**GA4 的代码检测是周期性爬虫，不是实时检查。** Google 官方口径是最多 **48 小时**才更新状态。
所以这条提示**极可能只是还没刷新**。

> ⚠️ 别用「标准报表」判断新装的标签 —— 标准报表本身有 24-48h 延迟，会双重误导。

---

## 三、两个「检测器会抓到错误页」的坑（都已实测）

GA4 检测器抓的是**你在数据流里填的那个 URL**。如果填错了，它抓到的是别的页面：

| 主机名 | 实测结果 |
|---|---|
| `https://cryptonav.site/` | **200**，带标签 ✅ |
| `http://cryptonav.site/` | 301 → https，200 ✅ |
| **`https://www.cryptonav.site/`** | **522**（连续 3 次），响应体只有 16 字节 `error code: 522`，**无标签** ❌ |
| `cryptonav.pages.dev` | 200，**但是别人的中文站**（`CryptoNav+`），不是我们的项目 ⚠️ |

`www` 的 DNS 记录存在（Cloudflare IP `172.66.44.64` / `172.66.47.192`）却返回 522 →
**记录在、但没挂到 Pages 项目上**。

**如果你在 GA4 数据流里填的是带 www 的地址，检测器抓到的就是那个 522 错误页 —— 正好就是这条报错。**

### 修法：一条 Redirect Rule（一次性，2 分钟）

Cloudflare 后台 → 你的域名 → **Rules → Redirect Rules → Create rule**：

- **When incoming requests match**：`Hostname` `equals` `www.cryptonav.site`
- **Then**：**Static redirect**，URL = `https://cryptonav.site/$1`，
  **Status code = 301**，勾选 **Preserve query string**

> 为什么用 Redirect 而不是把 www 加成第二个自定义域名：
> Redirect Rule 在**边缘求值、先于回源**，所以那个 522 不影响它生效；而且只保留一个正式域名，
> 顺带解决 SEO 重复内容问题。

---

## 四、⚠️ 我这边的探针在这台机器上得不出结论（已撤回一条旧记录）

我跑端到端探针时得到 `collectRequests: 0` + 3 个 `ERR_SSL_PROTOCOL_ERROR`，
看着像标签坏了。但**同一次请求里 `fonts.googleapis.com` 却返回 200** —— 这不合理，于是我逐域名验证：

| 域名 | 代理 10809 | 代理 10808 |
|---|---|---|
| `fonts.googleapis.com` | **200** | **200** |
| `www.googletagmanager.com/gtag/js` | **000** | **000** |
| `www.google-analytics.com/g/collect` | **000** | **000** |

→ **本机代理有规则专门屏蔽 GA / GTM 域名。**

所以：
- **上一轮我记的「挂代理 gtag.js→200、/g/collect→204、`_ga` cookie 已种下」不可复现，已作废。**
- **这台机器上任何 GA 探针的 `collectRequests: 0` 都是本机网络的产物，不是标签故障。**

已给 `scripts/check-ga-live.mjs` 加了**对照探测**：同时探 `fonts.googleapis.com`（对照）和两个 GA 域名，
输出 `verdict` 字段。命中「对照 200 但 GA 000」时直接报
`INCONCLUSIVE … NOT evidence that the tag is broken`，不会再误导（我自己已经踩过一次）。

---

## 五、请你按这个顺序做

1. **看 GA4 数据流 URL** —— 管理 → 数据流 → 点进那个 Web 流，
   确认网址是 `https://cryptonav.site`（**不带 www**）。若带 www，第二节第三节就是答案。
2. **修 www 的 522**（第三节的 Redirect Rule）—— 不管 GA4 如何，这本身是**访客可见的故障**：
   任何人手输 `www.cryptonav.site` 都会看到 Cloudflare 错误页。
3. **等 24-48 小时**再回来看这条提示。
4. **同时做决定性的验证**：用**能正常访问 Google 的浏览器**打开 cryptonav.site，
   然后看 GA4 → **报告 → 实时**。实时里出现活跃用户 = 标签完全正常，
   那条「未检测到」只是没刷新。**别用标准报表判断。**

> 注：如果你平时浏览自己的站也走会屏蔽 GA 域名的代理，那你自己产生的访问**永远不会计入**，
> 这会让 GA4 看起来"没数据"。用实时报表时要确认浏览器真的能加载 `googletagmanager.com`。
