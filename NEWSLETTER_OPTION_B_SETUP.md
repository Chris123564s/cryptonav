# Newsletter Option B — 收尾操作手册（需你手动）

> 代码已全部推到 `main`（commit `2dd35ba`）。`/api/unsubscribe`、`send-digest.mjs`、每周
> GitHub Action 都已就绪，但**以下 3 件事必须在后台手动做**，我无法代劳（密钥/数据库/域名）。

---

## 第 1 步：在 Supabase 跑退订 RPC（5 分钟，必做）

之前只建了 `newsletter_subscribers` 表。现在还要加**退订函数**，否则
`/api/unsubscribe` 会一直返回 502。

1. 打开你选的那个 Supabase 项目 → **SQL Editor → New query**
2. 粘贴 `supabase/newsletter_unsubscribe.sql` **整段**（也可以把整份
   `supabase/newsletter_subscribers.sql` 重新跑一遍，末尾已追加该函数）
3. **Run**
4. 验证：SQL Editor 跑
   ```sql
   select has_function_privilege('anon', 'public.newsletter_unsubscribe(text)'::regprocedure, 'EXECUTE');
   ```
   应返回 `t`（anon 可执行，这是有意的、已被函数体严格限定的删除单条）。

---

## 第 2 步：在 GitHub 加 Secrets（发周报用，必做）

`scripts/send-digest.mjs` 每周日 16:00 UTC 自动跑，需要这些 **GitHub Secrets**
（仓库 → Settings → Secrets and variables → Actions → New repository secret）：

| Secret 名 | 值 | 说明 |
|------------|-----|------|
| `SUPABASE_URL` | `https://<你的project>.supabase.co` | 和第 1 步同一个项目 |
| `SUPABASE_SERVICE_KEY` | 该项目的 **service_role** key（Settings → API） | ⚠️ 有 RLS 绕过权，**只在 GitHub Secrets，绝不进 Cloudflare/浏览器** |
| `RESEND_API_KEY` | `re_...` | 你已有的 Resend key（finditforme 同款） |
| `EMAIL_FROM` | `"CryptoNav <digest@cryptonav.site>"` | 发件人，域名须在 Resend 验证过 |
| `EMAIL_POSTAL_ADDRESS` | 真实邮寄地址（CAN-SPAM 强制） | 每封商业邮件必须有，脚本无此值拒绝发送 |

> 安全说明：网站用 **anon key**（只能 INSERT）。读订阅列表需要 SELECT，只有 service_role 有，
> 所以 service_role key 只放在 GitHub Secrets 的 runner 里，绝不下发到 Cloudflare 或浏览器。

---

## 第 3 步：Resend 验证发件域名（首次发信前，必做）

1. Resend 后台 → **Domains** → Add `cryptonav.site`
2. 按提示在 Cloudflare DNS 加 **SPF / DKIM / DMARC** 三条记录
3. 等状态变 **Verified**

没验证的话邮件会进垃圾箱或直接被拒。

---

## 第 4 步：首次手动验证（强烈建议，10 分钟）

GitHub → Actions → **Send Newsletter Digest** → **Run workflow**（手动触发一次）。
先在本地 dry-run 看排版：

```bash
cd /home/ubuntu/projects/cryptonav
node scripts/send-digest.mjs --dry-run          # 只看排版和数据，不发送
node scripts/send-digest.mjs --to=你自己的邮箱    # 给自己发一封真实测试
# 然后真发：
node scripts/send-digest.mjs                     # 需第 2 步的 env 全设好
```

---

## 未完成的 Git 推送（workflow 文件卡住）

`send-digest.yml` **没推上去**——你给的 GitHub token 缺 `workflow` scope，GitHub 拒绝
创建 `.github/workflows/` 下的文件（仓库里早先的 workflow 注释也写明过这点）。

文件还在本地未跟踪：`.github/workflows/send-digest.yml`。要推上去，二选一：
- **A.** 用带 `workflow` scope 的 PAT 重新 push（最干净）；或
- **B.** 你手动把这个文件内容贴进 GitHub 网页的 Actions 里新建 workflow。

在它进仓库前，周报**不会自动跑**，但你可以本地 `node scripts/send-digest.mjs` 手动发。

---

## 合规边界（已落实）

- 每封邮件含**每收件人独立退订链接** + RFC 8058 `List-Unsubscribe` 头（邮件客户端原生一键退订）
- 退订端点用密文 token（邮箱）+ GET，打开即生效，无需登录
- 退订 RIPC 用 `SECURITY DEFINER` 只删一条、返回 bool，不暴露任何数据；已显式 `REVOKE` 多余角色
- 商业邮件带真实邮寄地址（CAN-SPAM 强制，脚本无此值直接拒绝发）
- 文案已改为实话：「You're on the list. We'll email you our next digest.」（不再谎称"查收确认信"）
