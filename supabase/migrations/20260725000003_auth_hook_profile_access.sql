-- ============================================================================
-- 003 — Let the auth hook read profiles
--
-- Fixes a silent failure in the custom access token hook added by migration
-- 001: issued JWTs carried no `tenant_id` or `user_role` claim.
--
-- Diagnosis: `public.custom_access_token_hook` is not SECURITY DEFINER, so
-- Supabase Auth executes it as the `supabase_auth_admin` role. Migration 001
-- granted that role SELECT on public.profiles — but the table also has RLS
-- enabled, and **a GRANT does not bypass RLS**. With no policy matching
-- `supabase_auth_admin`, the hook's lookup returned zero rows, `v_tenant_id`
-- came back NULL, and the `if v_tenant_id is not null` guard skipped adding the
-- claims. No error, no log line — just tokens missing their claims.
--
-- This is doubly easy to miss because nothing appears broken: the RLS helpers
-- in 001 (app.current_tenant_id, app.current_user_role) fall back to a direct
-- profile lookup when the claim is absent, so authorization stays *correct* —
-- it just silently costs an extra query per policy check, forever.
-- `scripts/verify-jwt-hook.mjs` catches this by decoding a real issued token.
--
-- Fix: the policy Supabase's auth-hook documentation requires. Scoped to
-- SELECT, to this one role, on this one table.
-- ============================================================================

create policy profiles_auth_admin_read on public.profiles
  for select
  to supabase_auth_admin
  using (true);

-- Belt and braces: 001 already granted these, but re-granting is idempotent and
-- makes this migration self-contained if it is ever replayed onto a fresh
-- database where 001's grants were altered.
grant usage on schema public to supabase_auth_admin;
grant select on public.profiles to supabase_auth_admin;
