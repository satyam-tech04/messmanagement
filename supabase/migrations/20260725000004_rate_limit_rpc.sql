-- ============================================================================
-- 004 — Expose the rate limiter to the API layer
--
-- Migration 002 created `app.consume_rate_limit`, but the `app` schema is
-- deliberately not exposed through PostgREST (that is the point of putting the
-- security helpers there — a client must never be able to call them directly).
-- The consequence is that supabase-js `.rpc()` cannot reach it either, so the
-- rate limiting required by §12 for /api/qr/token and /api/qr/verify had no way
-- to actually run.
--
-- Fix: a thin wrapper in `public`, callable ONLY by the service role. The
-- counter logic stays in `app`; this just makes it reachable from server-side
-- code that already holds the service key.
--
-- Why the grant matters: a client that could call this could also exhaust its
-- own limit deliberately, or — worse — call it with someone else's bucket key
-- to lock another student out of their meal.
-- ============================================================================

create or replace function public.consume_rate_limit(
  p_bucket_key     text,
  p_window_seconds integer,
  p_max_requests   integer
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select app.consume_rate_limit(p_bucket_key, p_window_seconds, p_max_requests);
$$;

revoke execute on function public.consume_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer)
  to service_role;

-- Housekeeping: fixed-window counters accumulate one row per bucket per window
-- and are worthless once the window has passed. Without pruning, a mess doing
-- 1000 scans a day would grow this table indefinitely for no benefit.
create or replace function public.prune_rate_limits(p_older_than interval default '1 day')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.rate_limits
   where window_start < now() - p_older_than;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.prune_rate_limits(interval) from public, anon, authenticated;
grant execute on function public.prune_rate_limits(interval) to service_role;
