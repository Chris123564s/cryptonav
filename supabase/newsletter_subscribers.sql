-- Newsletter 订阅表（CryptoNav）
--
-- 用法：Supabase 后台 -> SQL Editor -> 粘贴执行。
--
-- 不需要新建 project：在现有任意 Supabase 项目里执行即可，一张表不占位子。
-- 建议选有真实流量的那个项目 —— 免费版会把 7 天不活跃的项目自动 Pause，
-- 项目一暂停订阅接口就 502，而没人会主动发现（平时本来也没人订阅）。
--
-- ⚠️ 两个约束是被 functions/api/subscribe.js 的行为逼出来的，改之前先读注释：
--
--   1) 列名必须和 generic provider 发的 payload 逐字一致：
--      { "email", "source", "subscribedAt", "site" }
--      PostgREST 遇到表里没有的列会返回 400，
--      而 subscribe.js 把上游 400 当成"已经在列表里"、直接给访客返回成功 ——
--      也就是说列名写错会**静默失败**：访客看到"订阅成功"，实际上一条都没存。
--      所以 "subscribedAt" 必须加双引号建列（不加引号 Postgres 会折叠成 subscribedat，
--      payload 里的 subscribedAt 就对不上了）。
--
--   2) 不能让重复邮箱返回 409。
--      subscribe.js 只把 ok 和 400 当成功，409 会变成"Subscription failed"抛给访客 ——
--      老用户重新订阅反而报错。所以这里用 BEFORE INSERT 触发器把重复吞掉：
--      返回 NULL = 跳过插入，PostgREST 回 201，访客正常看到成功。

create table if not exists public.newsletter_subscribers (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  "source"     text,
  "subscribedAt" timestamptz not null default now(),
  "site"       text,
  created_at   timestamptz not null default now(),

  -- 兜底：拦住明显不是邮箱的内容（函数侧已校验，这里再挡一层）
  constraint newsletter_email_shape
    check (email ~ '^[^[:space:]@]+@[^[:space:]@.]+(\.[^[:space:]@.]+)+$')
);

-- 重复邮箱静默跳过，避免 409 变成访客可见的错误
create or replace function public.newsletter_skip_duplicate()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from public.newsletter_subscribers where email = new.email
  ) then
    return null;   -- BEFORE INSERT 返回 NULL = 不插入，且不报错
  end if;
  return new;
end;
$$;

drop trigger if exists newsletter_skip_duplicate on public.newsletter_subscribers;
create trigger newsletter_skip_duplicate
  before insert on public.newsletter_subscribers
  for each row execute function public.newsletter_skip_duplicate();

-- 邮箱上建索引让上面的 exists 判断走索引（也方便日后导出去重）
create index if not exists newsletter_subscribers_email_idx
  on public.newsletter_subscribers (email);

-- ===== 权限：anon 只能插入，读不到 =====
alter table public.newsletter_subscribers enable row level security;

-- 没有 select 策略 = anon 一律读不到（邮箱列表不会泄露）
drop policy if exists "anon can subscribe" on public.newsletter_subscribers;
create policy "anon can subscribe"
  on public.newsletter_subscribers
  for insert
  to anon
  with check (true);

-- 自查（执行完跑一下，应该返回 t / t）：
-- select rowsecurity from pg_tables where tablename = 'newsletter_subscribers';
-- select count(*) = 0 from public.newsletter_subscribers;
