-- ============================================================================
-- 013 — Subscription pauses (the admin-facing "grace period")
--
-- An admin pauses a student's subscription while they are away. During the
-- pause the student still logs in, still sees their plan, but cannot obtain a
-- meal — and the days they lose are added back to the end of the subscription.
--
-- ## Why the table is not called grace_periods
--
-- `student_status` has had a `GRACE` value since migration 001, and it means
-- the *opposite* thing: a student with unpaid dues who is still allowed to eat,
-- so nobody is cut off overnight. `eligibility.policy.ts` says so in a comment.
-- Two rules with one name, pointing in opposite directions, is how a paused
-- student gets fed — or how a student in dues-grace gets refused in front of a
-- queue. The UI may say "grace period"; the schema says what it does.
--
-- ## end_date_before_pause is the load-bearing column
--
-- The requirement that shapes this table: an admin who edits a pause four times
-- must not extend the subscription four times. That cannot be computed from
-- `subscriptions.end_date`, because nothing distinguishes "this was pushed out
-- by the last pause edit" from "an admin moved it by hand". So the end date as
-- it stood when the pause was FIRST created is frozen here, and every
-- recalculation is `end_date_before_pause + days actually paused`. Idempotent
-- under any number of edits, and it gives cancel and early-resume their answers
-- for free.
--
-- ## Half-open dates, matching the policy
--
-- `[start_date, resume_date)`. The start date is the first paused day; the
-- resume date is the first day the student eats again and is never itself
-- paused. The exclusion constraint below uses the identical `[)` range, so the
-- database and `pause.policy.ts` cannot disagree about the boundary.
--
-- Backward compatible: every existing subscription simply has no rows here, and
-- `activePauseOn([])` returns null. Nothing changes for a student without a
-- pause.
-- ============================================================================

-- Needed for the exclusion constraint below, which mixes an equality test on a
-- uuid with an overlap test on a daterange. Available on Supabase.
create extension if not exists btree_gist;

-- Only what somebody DECIDED. Whether a live pause is scheduled, running or
-- finished is derived from its dates in `pause.policy.ts`, never stored --
-- there is no cron to flip a status column when a date arrives, and the same
-- mistake already left subscriptions sitting at ACTIVE months after they ended.
create type public.pause_status as enum ('ACTIVE', 'CANCELLED');

create table public.subscription_pauses (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,
  -- Denormalised from the subscription so RLS can answer "is this the signed-in
  -- student's own pause?" without a subquery, exactly as mess_cuts does.
  student_id      uuid not null references public.students (id) on delete cascade,

  -- First paused day, inclusive.
  start_date  date not null,
  -- First active day again. Never itself a paused day.
  resume_date date not null,

  -- The anchor. See the header comment -- this is what makes repeated edits
  -- idempotent instead of cumulative.
  end_date_before_pause date not null,
  -- What the system worked out: end_date_before_pause + grace days.
  computed_end_date     date not null,

  -- Required. `endSubscription` already refuses to cancel a plan without a
  -- reason, and pausing one is comparably consequential.
  remarks text not null,

  status public.pause_status not null default 'ACTIVE',

  -- Set when an admin resumed the student before the scheduled resume date.
  -- resume_date is rewritten to the early date, so the derived state and the
  -- extension both follow automatically; this only records that it happened.
  ended_early_at timestamptz,

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Equality, not `>`. An early resume on the very day the pause started leaves
  -- start = resume, meaning zero days paused and nothing owed back.
  constraint pauses_dates_ordered check (resume_date >= start_date),
  constraint pauses_remarks_not_blank check (length(btrim(remarks)) > 0),
  constraint pauses_ended_early_only_when_set
    check (ended_early_at is null or resume_date <= computed_end_date)
);

-- Serves the counter: "does this subscription have a pause covering today?"
create index subscription_pauses_tenant_sub_idx
  on public.subscription_pauses (tenant_id, subscription_id, start_date);

create index subscription_pauses_tenant_student_idx
  on public.subscription_pauses (tenant_id, student_id, start_date desc);

-- Spec §14: a subscription must never hold two overlapping pauses -- the admin
-- modifies the existing one instead. An application check cannot hold this when
-- two admins act at the same instant, so it is a constraint.
--
-- Non-overlapping *repeats* stay legal on purpose: a student may go home in
-- September and again in November. Cancelled rows are excluded so that
-- cancelling a pause frees its dates for a new one (§23).
alter table public.subscription_pauses
  add constraint subscription_pauses_no_overlap
  exclude using gist (
    subscription_id with =,
    daterange(start_date, resume_date, '[)') with &&
  ) where (status = 'ACTIVE');

create trigger subscription_pauses_set_updated_at
  before update on public.subscription_pauses
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS -- students read their own, staff read the tenant's, only admins write.
--
-- Staff read matters: the counter's student lookup embeds pauses, and that
-- query runs as the signed-in staff member. Without this policy the embed
-- returns an empty array and every paused student is silently served -- a
-- fail-open on the one path where §2.7 says fail closed.
-- ---------------------------------------------------------------------------

alter table public.subscription_pauses enable row level security;

create policy subscription_pauses_read_own on public.subscription_pauses
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and student_id = app.current_student_id());

create policy subscription_pauses_read_tenant on public.subscription_pauses
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_staff_or_admin());

create policy subscription_pauses_admin_write on public.subscription_pauses
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());

comment on table public.subscription_pauses is
  'Admin-configured pauses on a subscription ("grace periods"). Blocks meals for [start_date, resume_date) and extends the subscription by the days actually paused. end_date_before_pause is the anchor that keeps repeated edits from accumulating.';

comment on column public.subscription_pauses.end_date_before_pause is
  'The subscription end date at the moment this pause was FIRST created. Every recalculation is end_date_before_pause + days paused, so editing a pause repeatedly never compounds the extension.';
