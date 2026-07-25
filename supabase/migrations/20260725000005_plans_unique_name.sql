-- ============================================================================
-- 005 — A plan name is unique within a tenant
--
-- Found while seeding: an upsert targeting `(tenant_id, name)` failed because
-- no such constraint existed, so no plans were created at all — and because the
-- error went unchecked, the seed cheerfully reported "8 students with active
-- plans" having created none.
--
-- The constraint is right on its own merits, not just to make an upsert work.
-- The admin UI presents plans as a pick-list by name; two plans called
-- "Monthly — Lunch & Dinner" at different prices would be indistinguishable at
-- the moment of choosing, and the wrong price would then be snapshotted onto a
-- student's subscription permanently.
--
-- Case-insensitive, because "Monthly Plan" and "monthly plan" are the same
-- thing to everyone except a byte comparison.
-- ============================================================================

create unique index plans_tenant_name_key on public.plans (tenant_id, lower(name));
