# Newsletter 订阅上线清单（批次2 收尾）

> 代码已推送到 `main`（HEAD = `ddc7a50`）。订阅表单已嵌在首页侧栏、`/track`、`/wins`，
> `/api/subscribe` 逻辑完整，但**未接 Supabase 前会返回 503「Newsletter is not configured yet.」**
> 你只需在 Supabase + Cloudflare 后台手动填密钥即可生效。下面每步都是照抄执行。

---

## 第 1 步：Supabase 建表（5 分钟）

1. 打开 <https://supabase.com/dashboard> → 选一个**活跃**的 project（有真实流量的那个，避免免费版自动 Pause 导致接口 502）。
2. 左侧 **SQL Editor** → **New query** → 把仓库里的
   `supabase/newsletter_subscribers.sql` **整段粘贴**进去 → **Run**。
3. 跑完在下方 console 执行一次自查（应都返回 `t`）：
   ```sql
   select rowsecurity from pg_tables where tablename = 'newsletter_subscribers';
   select count(*) = 0 from public.newsletter_subscribers;
   ```
4. 记下这个 project 的 **Project URL**（形如 `https://xxxx.supabase.co`）和 **anon key**
   （Settings → API → `anon` / `public` key）。

> ⚠️ **关于 key 类型（重要，否则会静默失败）**：
> `/api/subscribe` 的 `generic` 模式只发 `Authorization: Bearer <NEWSLETTER_TOKEN>` 一个头。
> Supabase PostgREST 要的是 key 在 `apikey` 头，或 `Authorization` 里是有效 JWT。
> - ✅ **用 legacy `eyJ...` 开头的 anon key**（JWT，能直接塞进 Authorization）→ 立即生效。
> - ❌ **用新的 `sb_publishable_...` 不透明 key** → PostgREST 报 `PGRST301`，订阅失败。
> 所以第 2 步的 `NEWSLETTER_TOKEN` 请填 **legacy anon key（eyJ 开头）**；若你只有新格式 key，
> 告诉我，我把 `/api/subscribe` 改成同时发 `apikey` 头（改一行即可）。

---

## 第 2 步：Cloudflare 填环境变量（5 分钟）

1. <https://dash.cloudflare.com/> → **Workers & Pages** → **`cryptonav`**
2. **Settings** → **Environment variables** → **Add variable**

逐条添加（**大小写必须完全一致**），四条都**同时勾选 Production 和 Preview**：

| 变量名 | 值 | 类型 |
|--------|-----|------|
| `NEWSLETTER_PROVIDER` | `generic` | 普通文本 |
| `NEWSLETTER_ENDPOINT` | `https://<你的project>.supabase.co/rest/v1/newsletter_subscribers` | 普通文本 |
| `NEWSLETTER_TOKEN` | Supabase 的 **legacy anon key（`eyJ` 开头）** | ⚠️ **点 Encrypt 加密** |

> `NEWSLETTER_ENDPOINT` 不填就一直 503；`NEWSLETTER_TOKEN` 填错则插入被拒（接口把上游 400 当成功，
> 会「静默失败」—— 访客看到成功其实没存，所以 key 复制前务必核对手册第 1 步自查）。

3. 改完环境变量后，**必须 redeploy 一次**才会生效：
   - 若你用 Git 集成构建：在 Pages 项目里点 **Deployments** → 最新一条 → **Retry deploy**（或推一个空提交）。
   - 若手动部署：`npm run build && npx wrangler pages deploy dist`。

---

## 第 3 步：验证（2 分钟）

redeploy 完成后：

```bash
# 1) 接口应返回 ok:true（不再 503）
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"email":"real-test@yourdomain.com","source":"verify","consent":true}' \
  https://cryptonav.site/api/subscribe

# 2) 去 Supabase → Table Editor → newsletter_subscribers 看是否多出一行
# 3) 浏览器打开首页 / /track / /wins，表单可见、勾选同意框后能提交
```

预期：
- 接口返回 `{"ok":true}`
- Supabase 表里出现该邮箱（`source` 字段标记来自哪个页：`home-sidebar` / `track` / `wins`）
- 重复订阅同邮箱 → 接口仍返回成功（触发器吞掉重复，不会报 409）

---

## 第 4 步（可选，留存进阶）：发邮件

当前只**收名单**，不发信。要真正「拉回」用户，需要：
- 每周用 Supabase 导出的邮箱发一份摘要（手动 / n8n / Make / Zapier 都行），或
- 接入 Buttondown（免费 100 订阅者，把 `NEWSLETTER_PROVIDER` 改成 `buttondown` + 对应 endpoint/token）。

这一步涉及邮件服务商 + 退订合规（CAN-SPAM / GDPR），**先拿到名单、确认留存模型跑通再做**。

---

## 风险与边界

- **AdSense 合规**：表单放在有实质内容的页面（首页侧栏 / `/track` / `/wins`），不挨广告位、不建独立 thin 页，
  符合 `ADS-PROG-06` / `ADS-PUB-11`；隐私政策已补 newsletter 条款（`ADS-PRIV-01` 披露）。
- **数据归属**：`anon` 只给这张表 insert 权限、无 select，同 project 其他业务表碰不到。
- **密钥泄露面**：`NEWSLETTER_TOKEN` 是 anon key（公开可泄露级别，仅能插表），已 Encrypt；
  但 GitHub / Cloudflare token 仍**未 revoke**，是更大风险，建议尽快处理。
