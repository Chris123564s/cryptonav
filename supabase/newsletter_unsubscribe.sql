-- ============================================================================
-- Newsletter unsubscribe support (added 2026-09-16 for option-B self-hosted digest)
-- ============================================================================
-- Append this to supabase/newsletter_subscribers.sql and re-run the whole file,
-- OR run just the block below in Supabase SQL Editor.
--
-- Why an SECURITY DEFINER RPC instead of an anon DELETE:
--   The table's RLS only grants anon INSERT (no SELECT, no DELETE). Letting anon
--   DELETE by email would be an abuse vector (anyone could wipe the list). A
--   SECURITY DEFINER RPC scopes the deletion to ONE row by email and returns a
--   boolean, so the public anon endpoint can only ever unsubscribe that one email.
--
-- IMPORTANT (Supabase default-grant footgun): new public functions are auto-granted
-- EXECUTE to anon/authenticated. We explicitly REVOKE from anon/authenticated and
-- grant only to the anon API role path we actually use. But the /rest/v1/rpc/*
-- route is called with the anon key, so anon MUST keep EXECUTE here — that is
-- intended and safe because the function is tightly scoped (delete-by-email,
-- returns boolean, no other data access). Do NOT grant service_role anything extra.

create or replace function public.newsletter_unsubscribe(target_email text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted int := 0;
begin
  -- Guard: ignore obviously malformed input.
  if target_email is null or target_email !~ '^[^@\s]+@[^@\s.]+\.[^@\s.]+$' then
    return false;
  end if;
  delete from public.newsletter_subscribers
  where lower(email) = lower(target_email);
  get diagnostics deleted = row_count;
  return deleted > 0;
end;
$$;

-- Explicit grants: anon needs EXECUTE (it calls /rest/v1/rpc/newsletter_unsubscribe
-- with the publishable key). Revoke the broader roles to avoid surprise exposure.
revoke execute on function public.newsletter_unsubscribe(text) from public;
grant execute on function public.newsletter_unsubscribe(text) to anon;

-- Unsubscribe is idempotent and low-risk, so no rate-limit trigger is required.
