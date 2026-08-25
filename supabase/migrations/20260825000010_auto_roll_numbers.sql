-- ============================================================================
-- 010 — Auto-assigned roll numbers
--
-- Campus Crave has been typing roll numbers by hand: 3, 4, 5 … 45, 51, 56, 67.
-- The gaps are the tell — somebody is tracking the next free number in their
-- head while a queue of new students waits.
--
-- Two things this must get right.
--
-- **It cannot race.** The obvious implementation, `max(roll_number) + 1`, is
-- wrong here and would be wrong intermittently, which is worse. The bulk form
-- creates twenty-five students in one submission and the CSV import creates
-- hundreds; two admins enrolling at the same time is ordinary. Every one of
-- those is a chance for two students to read the same maximum and be handed the
-- same number — and the roll number is baked into the login address, so the
-- second one fails to be created at all, halfway through a batch, with auth
-- users already written. The counter below is incremented inside an UPDATE,
-- which takes a row lock, so concurrent callers queue rather than collide.
--
-- **It is per mess, not global.** A hostel with real institutional roll numbers
-- (CS21B001) must keep typing them; one that just wants the next number should
-- never see the field. That is a policy value, so it lives in tenant_settings
-- beside every other one (§1.1) and defaults to OFF — no existing mess changes
-- behaviour when this migration lands.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The policy switch
-- ---------------------------------------------------------------------------

alter table public.tenant_settings
  add column auto_roll_numbers boolean not null default false;

comment on column public.tenant_settings.auto_roll_numbers is
  'When true, the admin never types a roll number: the next one is allocated by app.allocate_roll_number(). Off by default so a mess using institutional roll numbers keeps typing them.';

-- ---------------------------------------------------------------------------
-- The counter
--
-- On `tenants` rather than `tenant_settings` deliberately: tenant_settings is
-- the policy store, and every value in it is a rule an admin chose. This is not
-- a rule, it is bookkeeping — the next number to hand out — and it changes on
-- every enrolment rather than twice a year.
-- ---------------------------------------------------------------------------

alter table public.tenants
  add column next_roll_number bigint not null default 1;

alter table public.tenants
  add constraint tenants_next_roll_number_positive check (next_roll_number >= 1);

comment on column public.tenants.next_roll_number is
  'Next auto-assigned roll number for this mess. Allocated only through app.allocate_roll_number(), which increments it under a row lock. Never read-then-written from application code.';

-- Start each mess above whatever it has already issued by hand, so the first
-- auto-assigned number cannot collide with an existing student. Campus Crave's
-- highest is 67, so it continues at 68. Non-numeric roll numbers (CS21B001) are
-- ignored: they are not on the same number line and never will be.
update public.tenants t
set next_roll_number = coalesce(
  (
    select max(s.roll_number::bigint) + 1
    from public.students s
    where s.tenant_id = t.id
      and s.roll_number ~ '^[0-9]+$'
      -- Beyond bigint there is nothing sensible to continue from, and casting
      -- would raise rather than return null.
      and length(s.roll_number) <= 18
  ),
  1
);

-- ---------------------------------------------------------------------------
-- Allocation
--
-- SECURITY DEFINER and granted to service_role only. Student creation already
-- runs with the service role (it must — it calls auth.admin), and nothing a
-- browser can reach has any business advancing a mess's counter.
--
-- Returns the number that was just claimed. The `- 1` is because the column
-- holds the *next* number, not the last one issued.
-- ---------------------------------------------------------------------------

create or replace function public.allocate_roll_number(p_tenant_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allocated bigint;
begin
  update public.tenants
     set next_roll_number = next_roll_number + 1
   where id = p_tenant_id
  returning next_roll_number - 1 into v_allocated;

  -- No row means no such mess. Raising beats returning null, which the caller
  -- would happily turn into a student with the roll number "null".
  if v_allocated is null then
    raise exception 'no mess with id %', p_tenant_id
      using errcode = 'no_data_found';
  end if;

  return v_allocated;
end;
$$;

revoke execute on function public.allocate_roll_number(uuid) from public, anon, authenticated;
grant execute on function public.allocate_roll_number(uuid) to service_role;
