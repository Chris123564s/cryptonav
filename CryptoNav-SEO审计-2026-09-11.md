# CryptoNav SEO / 内容审计

**日期**：2026-09-11 · **方法**：测量构建产物（`dist/**/*.html`）+ 线上响应头
**样本**：174 个已构建页面；剔除 `/embed/*`（17 词的 iframe 徽章）与 `/admin/`（Decap 外壳）后
= **110 个真实内容页** / 85,891 词
**复现**：`node scripts/audit-content.mjs`（已入库，纯诊断、不参与 `npm test`）

> ⚠️ 本报告的数字来自上面这个脚本。审计过程中我先用四个临时脚本跑过一轮，
> 其中**两个数字是错的**（"66 个零入链页"和"内容/标记比中位 8.9"），原因见文末「更正」。

---

## 一句话结论

**站点技术上干净（0 死链、meta 零缺陷、sitemap 正确、静态资源缓存正常），但结构上无法积累权重**
—— 110 个内容页每页都挂着同样的 72 条导航内链，商业页是全场最薄的内容（中位 371 词），
**且每一个商业页面族的第一方经验信号都是 0**。这不是改标签能解决的，是内容策略问题。

---

## 一、可测量的问题

| # | 问题 | 实测数字 | 为什么是问题 | 置信度 |
|---|---|---|---|---|
| 1 | **商业页是最薄的内容** | `/category/*` 中位 **371** 词（n=10，最薄 `/category/security/` **290**）；`/compare/*` 中位 **503**（n=6）。对比 `/chain/*` **1218**、`/learn/*` **1378** | 赚钱的页投入最少，不赚钱的页投入最多 | 实测 |
| 2 | **第一方经验信号 = 0** | `/category/*` **0/10**、`/compare/*` **0/6**、`/chain/*` **0/10**、`/learn/*` **0/9**。唯一命中的 `/verify/*` **63/64** 是功能 UI 模板句（"What we verified … via MarkMonitor"），**不是内容** | YMYL（金融）站点上这是可行动性最高的单项。有真实经验信号的页面可见度 +38%，纯罗列页 **−63%** | 实测 |
| 3 | **正文内链被导航淹没** | 每页固定 **72** 条 chrome 内链。`/compare/binance-vs-coinbase` 正文只有 **2** 条（**97%** 是导航）；`/learn/what-is-defi` **5** 条（**94%**）；`/verify/binance` **9** 条（**89%**） | 技能阈值：导航占比 >30% 即意味着爬虫信号由导航主导。这些页无法把权重导向任何目标 | 实测 |
| 4 | **内链图扁平** | 110 页中 **31** 个目标被 ≥90% 的页面链接（全是 header/footer）；入链中位数 **7** | 没有 hub-and-spoke，就没有办法把权威集中到商业页 | 实测 |
| 5 | **`/chain/ton/` 是彻底的孤儿页** | 全站 **0** 条入链（唯一入链为 0 的内容页，另一个是 `/404.html`） | 页面被构建、**进了 sitemap**（邀请 Google 抓）、却从任何地方都点不到 | 实测 |
| 6 | **根因是同一个 `slice(0, 8)` 写在两处** | `chains.json` 有 **10** 条链。`Header.astro:5` → `chains.slice(0, 8)`（sui/ton 无导航入链）；`chain/[slug].astro:21` → `chains.filter(c => c.id !== chain.id).slice(0, 8)` | 见下方「精确机制」——**这是全报告里唯一一个一行就能修的结构性 bug** | 实测 |
| 7 | **链页体量爆炸** | `/chain/ethereum/` **328KB**：标签占 **295KB**、正文只有 **33KB**。941 个 `<div>` + 308 个 `<a>` + 97 个 `<img>`；`class=` 属性总长 **155KB**。正文 **186** 条内链**去重后只有 10 个目标**（重复约 19 倍） | 不是"页面大"，是同一组链接被渲染了近 20 遍 | 实测 |
| 8 | **链页 `<img>` 全部缺尺寸** | `/chain/ethereum/` **97** 个 img，带 `width=` 的 **0** 个（`loading="lazy"` 97/97 已加）；polygon/arbitrum/bsc 同样 **0** | 无法预留空间 → CLS，直接影响 Core Web Vitals | 实测 |
| 9 | **内容/标记比** | 中位 **16.0** words/KB（阈值 15），**36/110** 页低于阈值；最差的 6 个全是链页（**4.2–4.3**） | 模板占比过大，稀释正文信号 | 实测 |
| 10 | **robots.txt 被平台层注入后自相矛盾** | 通配组 `User-agent: *` 出现 **2** 次，`Content-Signal` 两套值（`use=reference` vs `ai-input=yes`）；**`Amazonbot` 一个 `Disallow: /`、一个 `Allow: /`** | 我们仓库文件明确写了要放行 Amazonbot。歧义 = 爬虫自己猜 | 实测 |
| 11 | **商业页无任何非导航入链** | `/compare/*` 6 页、`/category/*` 10 页：入链数全部来自 chrome | 与 #4 同源，但值得单独说：这些页在站内是"死胡同" | 实测 |

### #6 的精确机制（这个值得单独看）

`chains.json` 的顺序是：`1=ethereum 2=solana 3=bsc 4=arbitrum 5=base 6=polygon 7=avalanche
8=optimism 9=sui 10=ton`。

```
Header.astro:5      chains.slice(0, 8)
                    -> ethereum,solana,bsc,arbitrum,base,polygon,avalanche,optimism
                    漏掉 sui、ton  => 这两页没有导航入链

chain/[slug].astro:21   chains.filter(c => c.id !== chain.id).slice(0, 8)
  ethereum 页的 Explore Other Chains -> solana,bsc,arbitrum,base,polygon,avalanche,optimism,SUI
  sui      页的 Explore Other Chains -> ethereum,solana,bsc,arbitrum,base,polygon,avalanche,optimism
  ton      页的 Explore Other Chains -> ethereum,solana,bsc,arbitrum,base,polygon,avalanche,optimism
```

**读法**：对前 8 条链的页面，`filter` 掉自己之后，第 8 个位置正好由 **sui** 补上
→ sui 拿到 8 条入链。但对 **sui 自己的页面**，`filter` 把 sui 去掉后前 8 个又变回那 8 条导航链
→ **ton 从此不在任何页面的列表里**。所以 sui 只是"没有导航入链"，而 **ton 是真正的孤儿**。

**同一个 `slice(0, 8)` 出现在两个文件里，而列表有 10 项 —— 尾部两项必然不可达。**

---

## 二、检查过、确认没问题的（别动）

| 项 | 实测 |
|---|---|
| 死链 | **0**（110 URL 内链巡检，CI 31 秒跑完） |
| title 超长 | **0** 条 >65 字符 |
| 重复 description | **0** 组 |
| 多 H1 | **0** 页 |
| sitemap | **109** URL，`/embed/*` 已正确排除，指向 `/sitemap-index.xml`，**200** |
| `_routes.json` | `{"include":["/api/*"],"exclude":[]}` —— 正确，Functions 只吃 `/api/*` |
| `_headers` 生效 | 静态 HTML 返回 `Cache-Control: public, max-age=0, s-maxage=86400, stale-while-revalidate=604800` |
| hash 资源缓存 | `/_astro/*.css` → `cf-cache-status: HIT`，`immutable` |
| 图片缓存 | `/logos/tokens/*.png` → `HIT`（`max-age=604800`） |
| logo 完整性 | 链页 **782** 个 logo 引用本地**全部存在**，线上抽样全 200 |
| `_headers` / `_routes.json` 线上 404 | **正确** —— 被 Pages 消费，不对外提供 |

> 「no H1: 64」「description <70: 64」这两个数字**不是问题** —— 64 正好是 `/embed/*` 徽章页的数量，
> 徽章本来就不该有 H1 和长描述。

### 关于 HTML 的 `cf-cache-status: DYNAMIC`

全站 HTML 恒为 `DYNAMIC`（含 `/category/*` 这类纯静态页），**这不是 bug，也不建议修**：

- `_headers` 已生效，`_routes.json` 已把 Functions 限制在 `/api/*` → **请求并没有进 compute**，
  只是没走边缘 HTML 缓存（Cloudflare 默认不缓存 HTML）。
- 想让它变 `HIT` 需要后台加 **Cache Rule（Cache Everything）**，代价是 HTML 按 `s-maxage=86400`
  缓存 **24 小时** + `stale-while-revalidate` **7 天**。
- 本站数据 **6 小时**刷新一次 → **缓存 HTML 反而会发布过期数据**。
- **结论：保持现状。** 用几分钟的边缘延迟换数据新鲜度，这笔交易是划算的。

---

## 三、需要你拍板的战略问题（不是我能替你决定的）

### 1. 内容策略：商业页要不要重写？

现状是 `/category/*`（赚钱的页）**371 词 + 0 经验信号**，`/learn/*`（不赚钱的页）**1378 词**。
要让商业页有竞争力，需要把它们做到 **1200+ 词并加入第一方经验**（"我们实际测了什么、
数据从哪来、什么时候复核"）。

**这是 5 倍的内容投入，不是一次改版。** 即使 SEO 技术项全修完，这些页也排不上去。

### 2. 站点量级

技能里的判据：2026 年核心更新后，**单主题站低于约 150 页**会在分类层崩塌。本站 **110 个内容页**，
正卡在阈值下方。是继续加页（`/compare/*` 只有 6 篇、`/category/*` 10 篇都还很薄），
还是接受它是一个"导航工具站"而非"内容站"——这决定了要不要投入内容。

### 3. robots.txt 的 AI 爬虫策略

仓库文件封了 GPTBot / ClaudeBot / CCBot / Applebot-Extended / Bytespider / Google-Extended /
meta-externalagent，**但明确要放行 Amazonbot**（注释写着"封了就从 AI 回答里消失"）。
Cloudflare 的 Managed robots.txt 在平台层又注入了 `Amazonbot: Disallow: /` —— **平台层覆盖了你的意图**。

要么去后台关掉 Managed robots.txt（一个开关，零代码），要么接受 Amazonbot 被封。
**注意**：`Google-Extended` 只管 Gemini 和模型训练，**不影响 Google Search 的 AI Overviews**（那走搜索索引）。

### 4. GA4 欧盟同意弹窗

GA4 在欧盟属于需要**事先同意**的追踪 cookie，站上目前是访问即加载。落点就是 `Layout.astro` 那段。
（已单独说明过，仍在等你决定。）

---

## 四、本周就能做的（机械、低风险）

| 优先级 | 动作 | 工作量 | 预期 |
|---|---|---|---|
| P0 | **改掉两处 `slice(0, 8)`** —— `Header.astro:5` 与 `chain/[slug].astro:21`。要么 10 条链全进导航，要么把 sui/ton 从 sitemap 摘掉并 noindex | **2 行代码** | 消除全站唯一的孤儿页，回收抓取预算 |
| P0 | **关掉 Cloudflare Managed robots.txt**（后台 Security → Bots / AI Crawl Control） | 1 个开关 | 消除 Amazonbot 与 Content-Signal 的 4 处自相矛盾 |
| P1 | **给链页 `<img>` 补 `width`/`height`**（或 CSS `aspect-ratio`） | 1 个组件 | 消除链页全部 CLS 来源 |
| P1 | **6 个联盟码**（okx / coinbase / kraken / gate-io / bitget / mexc） | 你发链接，我改 | 34 处 promo 立刻变现（与 SEO 无关，但同属"发个链接就完事"） |
| P2 | **给 `/compare/*`、`/category/*` 加正文内链**（项目卡片链到它的 `/verify/*`，对比页互链） | 2-3 小时 | 从"死胡同"变成 hub-and-spoke，是内容重写的前置条件 |

---

## 五、诚实的时间线

- 上面这些机械项：**1-2 天**可全部上线。
- 但**排名变化最早 8-12 周**才可能看到，且**前提是内容重写**（第三节第 1 条）。
- 本站 DA≈0，新站在金融类目里，**6-12 个月**是现实预期，不是 1-2 个月。
- 技术项（第四节）**不会带来流量增长**，它们只是**不让你继续漏**。真正的杠杆在第三节。

---

## 六、更正（我自己先算错的两个数）

| 我先前说的 | 实际 | 为什么错 |
|---|---|---|
| "66 个零入链页" | **2 个**（`/404.html`、`/chain/ton/`） | 我把 61 个 `/embed/*` 徽章也算了进去。它们是 `noindex` 的 iframe 组件、**本来就不该被链接** —— 把设计如此的东西报成问题，会稀释真问题（`ton`）。另外 `/chain/sui/` 也**有** 8 条入链（来自 8 个链页的 "Explore Other Chains"），只是没有导航入链 |
| "内容/标记比中位 8.9，102 页低于阈值" | 中位 **16.0**，**36/110** 低于阈值 | 那个中位数是在**全部 174 页**上算的，其中 64 个 `/embed/*` 徽章每页只有 17 词 / 约 2KB（比值 8.5），把中位数整体拉了下来。剔掉徽章后本站的比值其实**高于**阈值 |

**教训：报告任何"中位数/占比"之前，先确认分母里没有结构性不该被算进来的页面。**
（`scripts/audit-content.mjs` 现在把 `/embed/*` 与 `/admin/` 作为显式常量排除，
就是为了让这个错误不能重犯。）
