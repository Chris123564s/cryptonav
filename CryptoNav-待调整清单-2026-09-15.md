# CryptoNav 待调整清单 — 2026-09-15

复核方式：线上实测（apex / www / robots.txt / sitemap / 22 个抽样页面）+ 仓库源码 + 构建产物审计。
构建产物为 9-11 的构建，**但自 9-11 起没有任何内容提交**（远端 28 个提交全是 `chore: refresh ...` 机器人数据刷新），
所以内容审计数字仍然有效。

---

## 一句话结论

**技术上依然干净，但 4 天前列的 6 项待办一项都没做** —— 其中最贵的一项每天都在漏钱：
**32 处广告位在免费给别人导流。**

---

## 🔴 P0 — 只能你来（我改不了，都是后台或凭据）

### 1. 6 个联盟码还是空的 → 32 处广告位不赚钱

实测（`grep data-promo-project` 统计构建产物）：

| 项目 | 渲染次数 | 有码？ | 能否赚钱 |
|---|---|---|---|
| binance | 11 | ✅ `GRO_28502_B2R17` | ✅ |
| **okx** | **11** | ❌ 空 | ❌ |
| **kraken** | **9** | ❌ 空 | ❌ |
| **gate-io** | **9** | ❌ 空 | ❌ |
| **coinbase** | **1** | ❌ 空 | ❌ |
| **bitget** | **1** | ❌ 空 | ❌ |
| **mexc** | **1** | ❌ 空 | ❌ |
| bybit（直投 ad-006） | 84 | ✅ `166214` | ✅ |

**全站 127 处广告渲染，95 处能赚（75%），32 处纯导流。**
`code` 一填，那 32 处立刻变成返佣链接 —— 不需要改代码。

**改哪**：`src/data/affiliates.json` → `exchanges` 里 6 个 `code`
（网页改：`https://github.com/Chris123564s/cryptonav/edit/main/src/data/affiliates.json`）

### 2. `www.cryptonav.site` 还是 522（4 天前就报过）

实测 DNS：

| 主机 | 解析到 | 结果 |
|---|---|---|
| `www.cryptonav.site` | `172.66.44.64` / `172.66.47.192` + IPv6 | **522**（16 字节错误页） |
| `cryptonav.site` | `104.21.28.195` / `172.67.147.106` | 200（145 KB 正常页） |

两条记录指向**不同的源**：www 那条是独立的、没挂到 Pages 项目的记录。因为它在 Cloudflare 上**是已代理状态**，
所以 **Redirect Rule 一定能生效**（不需要碰 DNS，也不要把它加成第二个自定义域名 —— 那会引入重复内容）。

**修**：CF → **Rules → Redirect Rules → Create rule**
- 匹配：`http.host eq "www.cryptonav.site"`
- 动作：**Static redirect** → `https://cryptonav.site/$1`，状态 **301**，勾选保留 query string

**为什么这件事和 GA4 有关**：如果 GA4 数据流里填的是带 www 的地址，检测器抓到的就是这个 16 字节错误页 →
"未检测到 Google 代码"永远不会消失。

---

## 🟠 P1 — 我能直接改（说一声就动手）

### 3. Cloudflare Managed robots.txt 还开着 → 线上有两套矛盾指令

线上 `/robots.txt` 共 171 行，**两套块并存**：

| | Cloudflare 注入块（第 27-58 行） | 我们自己的块（第 60-171 行） |
|---|---|---|
| `Content-Signal` | `search=yes,ai-train=no,use=reference` | `ai-train=no, search=yes, ai-input=yes` |
| `Amazonbot` | `Disallow: /` | `Allow: /` |

**准确判断（别夸大）**：按 RFC 9309，同长度规则冲突时 **Allow 胜出**，所以 Amazonbot 实际上**没有被挡**。
真正的问题是两个 `Content-Signal` 值不同 → **AI 引用政策是模糊的**，机器读者会拿到互相矛盾的两套指令。

**修**：CF 后台 → Settings → 关掉 Managed robots.txt（一个开关）。

### 4. `/chain/ton/` 仍是全站唯一孤儿页（第 3 次确认，0 入链）

根因是同一个 `slice(0, 8)` 写在两处，而 `chains.json` 有 **10** 条：

| index | id | 在导航里？ | 能从链页入链？ |
|---|---|---|---|
| 0-7 | ethereum … optimism | ✅ | ✅ |
| 8 | **sui** | ❌ | ✅（其他链页列表里） |
| 9 | **ton** | ❌ | ❌ **永远进不去** |

- `src/components/Header.astro:5` → `chains.slice(0, 8)`
- `src/pages/chain/[slug].astro:21` → `chains.filter(c => c.id !== chain.id).slice(0, 8)`
  （10 条减掉自己 = 9 条，取前 8 → **永远砍掉最后一条 = ton**）

**2 行可修。** `/chain/ton/` 本身 200 正常、有 848 词内容，纯粹是没人链接它。

### 5. 链页图片 0 个带 `width`/`height` → 纯 CLS

| 页面 | `<img>` 总数 | 带 `width=` |
|---|---|---|
| `/chain/ethereum/` | 97 | **0** |
| `/chain/polygon/` | 88 | **0** |
| `/chain/arbitrum/` | 88 | **0** |
| `/chain/bsc/` | 87 | **0** |

链页是站上**最厚的内容族**（中位 1218 词），也是核心着陆页。图片没有尺寸声明 → 布局抖动，
直接影响 Core Web Vitals（CLS 是 Google 明确用于排名的三项指标之一）。

### 6. 没有 HSTS

响应头里**没有 `Strict-Transport-Security`**（`x-content-type-options: nosniff` 和
`referrer-policy` 都有，缺这一个）。

站上有 `/admin/` 的 Decap CMS 登录，建议开：CF → **SSL/TLS → Edge Certificates → HSTS**。
⚠️ 开之前确认**所有子域**都能跑 HTTPS，HSTS 是单向的、回不去。

---

## 🟡 P2 — 需要你拍板

### 7. 商业页最薄（投入与商业价值倒挂）

| 页面族 | 中位词数 | 区间 |
|---|---|---|
| **`/category/*`（商业页）** | **371** | 290–641 |
| `/compare/*`（商业页） | 503 | 424–544 |
| `/verify/*` | 716 | 668–1272 |
| `/chain/*` | 1218 | 848–1372 |
| `/learn/*`（文章） | **1378** | 670–1494 |

最薄的 5 个内容页：`/category/security/` 290、`/category/media/` 293、`/category/nft/` 300、
`/category/tools/` 327、`/category/infra/` 369 词。

→ **钱在 `/category/*`，但词写在 `/learn/*`。** 是否把 10 个 category 页重写到 1200+ 词？（约 5 倍投入）

### 8. 第一方经验信号 = 0

`/category/*` 0/10、`/compare/*` 0/6、`/chain/*` 0/10、`/learn/*` 0/9
（`/verify/*` 的 63/64 是功能 UI 模板句，不算内容）。
在 YMYL（金融）领域，这是最可行动的单项 —— Google 对这类页面明确要求"经验 / 专业性"信号。

### 9. GA4 欧盟同意弹窗 —— 仍然没有
### 10. Bitmedia / Coinzilla 广告代码 —— `ad-network.json` 的 8 个 `html` 字段全空

---

## ⚪ P3 — 观察，不建议现在动

- **HTML 声明了 `s-maxage=86400`，但 `cf-cache-status: DYNAMIC`** → 边缘实际没缓存 HTML。
  站点数据每几小时刷新一次，不缓存反而保证新鲜；只是这个头是"名义上的"。
  **建议保持现状**，别为了一个指标去引入陈旧数据。
- **`Access-Control-Allow-Origin: *` 加在所有 HTML 上**（不在 `public/_headers` 里，来源不明，
  可能是后台的 Transform Rule 残留）。静态 HTML 上无害，但是个没人解释的配置 —— 有空查一下来源。

---

## ✅ 本次复核为"健康"的项（不用管）

- **meta 卫生 0 缺陷**：110 个内容页 —— title 过长 0 / 过短 0、description 过长 0 / 过短 0、
  重复 description 0 组、无 H1 0、多 H1 0。
  ⚠️ 顺带修了**我自己审计脚本的一个假阳性**：meta 段原来遍历 `all` 而不是 `real`，
  把 64 个 `/embed/*`（17 词的 noindex 徽章 iframe）算进来，误报"64 页无 H1 / description 过短"。
  修好后全是 0。**这是同一个错误第二次出现（分母没确认），已在脚本里写进注释。**
- **0 死链**：抽样 22 个页面全部 200；sitemap 109 个 URL，与 4 天前完全一致（没丢页也没新增）。
- **GA4 标签仍在**：首页 2 处，位置正常。
- **广告位 0 空缺**：127 处渲染，**0 处** "Your Ad Here" 占位。
- **ad-006 到期不会掉成不赚钱的位子**：`endAt 2026-10-04`（还有 19 天）。到期后 `home-banner`
  回落到 promo，而 `ad-network.json` 里 home-banner 的 `projectId` **正是 bybit**，bybit 有码 → 仍然赚钱。
- **数据工作流正常**：远端比本地领先 28 个提交，全是 `chore: refresh airdrops / chain tokens / safety / wins`。
- **`/api/submit` 的构建 DoS 修复仍然有效**（`verify` / `embed` 走 `getActiveProjects()`）。

---

## 建议的动作顺序

1. 填 6 个联盟码（**唯一的"立刻多赚钱"动作**，只需粘贴）
2. 加 www 的 Redirect Rule（修访客可见故障 + 解开 GA4 检测）
3. 关掉 Managed robots.txt（消除矛盾指令）
4. 让我改 `/chain/ton/` 孤儿页（2 行）+ 链页图片尺寸
5. 决定商业页要不要重写
