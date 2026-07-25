-- ============================================================================
-- 002 — Operations: plans, subscriptions, menus, attendance, mess cuts,
--                   headcount snapshots, rate limits
--
-- This is the Phase 1 operating loop (architecture doc §4.2, §4.4). The money
-- layer — invoices, ledger_entries, payments — is deliberately NOT here; it
-- arrives in migration 003 with Phase 2. Everything below is shaped so that
-- addition is additive: subscriptions already snapshot their price, and
-- mess_cuts already carries its credit columns.
-- ============================================================================

create type public.plan_duration as enum ('MONTHLY', 'QUARTERLY');
create type public.subscription_status as enum
  ('PENDING_PAYMENT', 'ACTIVE', 'EXPIRED', 'CANCELLED');
create type public.attendance_method as enum ('QR', 'MANUAL', 'RFID');
create type public.mess_cut_status as enum ('APPROVED', 'REJECTED', 'CANCELLED', 'CREDITED');

-- ---------------------------------------------------------------------------
-- plans (§4.2)
-- ---------------------------------------------------------------------------

create table public.plans (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants (id) on delete cascade,
  name                 text not null,
  duration_type        public.plan_duration not null,
  duration_days        integer not null,
  price_paise          bigint not null,
  included_meal_slots  public.meal_slot[] not null,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint plans_name_not_blank check (length(btrim(name)) > 0),
  constraint plans_duration_days_positive check (duration_days between 1 and 400),
  -- Money is integer paise, always (§2.3).
  constraint plans_price_nonneg check (price_paise >= 0),
  constraint plans_meal_slots_not_empty check (array_length(included_meal_slots, 1) > 0)
);

create index plans_tenant_active_idx on public.plans (tenant_id, is_active);

create trigger plans_set_updated_at
  before update on public.plans
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- subscriptions (§4.2)
--
-- The snapshot columns are the important part. When the admin raises the plan
-- price next quarter, existing subscribers must not have their historical
-- invoices silently recalculated. Never compute past money from present
-- configuration.
-- ---------------------------------------------------------------------------

create table public.subscriptions (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  plan_id    uuid not null references public.plans (id) on delete restrict,

  -- Frozen at activation. Never read the plan row for historical money.
  price_paise_snapshot         bigint not null,
  included_meal_slots_snapshot public.meal_slot[] not null,

  start_date date not null,
  end_date   date not null,
  status     public.subscription_status not null default 'PENDING_PAYMENT',
  auto_renew boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint subscriptions_price_nonneg check (price_paise_snapshot >= 0),
  constraint subscriptions_dates_ordered check (end_date >= start_date),
  constraint subscriptions_slots_not_empty
    check (array_length(included_meal_slots_snapshot, 1) > 0)
);

create index subscriptions_tenant_status_end_idx
  on public.subscriptions (tenant_id, status, end_date);
create index subscriptions_tenant_student_idx
  on public.subscriptions (tenant_id, student_id, start_date desc);

-- A student may hold only one ACTIVE subscription at a time. Two overlapping
-- active subscriptions would double-count that student in every headcount and
-- make "which plan does this meal belong to?" unanswerable.
create unique index subscriptions_one_active_per_student
  on public.subscriptions (tenant_id, student_id)
  where status = 'ACTIVE';

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- menus (§4.4)
-- ---------------------------------------------------------------------------

create table public.menus (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  -- Plain date, computed in the tenant's timezone (§2.9). Never derived from a
  -- UTC instant.
  service_date date not null,
  meal_slot    public.meal_slot not null,
  items        jsonb not null default '[]'::jsonb,
  notes        text,
  published_by uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint menus_tenant_date_slot_key unique (tenant_id, service_date, meal_slot),
  constraint menus_items_is_array check (jsonb_typeof(items) = 'array')
);

create index menus_tenant_date_idx on public.menus (tenant_id, service_date);

create trigger menus_set_updated_at
  before update on public.menus
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- attendance (§4.4)
--
-- The unique constraint below is the anti-double-serving and anti-replay
-- guarantee, and it is doing the real security work in the QR design (§6.2):
-- a replayed token within its TTL is rejected here, not by the short TTL.
-- Being a database constraint rather than an application check is what makes
-- it hold under concurrent scans from two counters.
-- ---------------------------------------------------------------------------

create table public.attendance (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  student_id   uuid not null references public.students (id) on delete cascade,
  service_date date not null,
  meal_slot    public.meal_slot not null,
  scanned_at   timestamptz not null default now(),
  method       public.attendance_method not null default 'QR',
  verified_by  uuid references public.profiles (id) on delete set null,
  device_id    text,
  -- Mandatory for MANUAL entries; these are exactly the rows that become
  -- disputes, so the reason is enforced rather than encouraged.
  override_reason text,
  created_at   timestamptz not null default now(),

  constraint attendance_tenant_student_date_slot_key
    unique (tenant_id, student_id, service_date, meal_slot),
  constraint attendance_manual_requires_reason
    check (method <> 'MANUAL' or length(btrim(coalesce(override_reason, ''))) > 0)
);

create index attendance_tenant_date_slot_idx
  on public.attendance (tenant_id, service_date, meal_slot);
create index attendance_tenant_student_idx
  on public.attendance (tenant_id, student_id, service_date desc);

-- ---------------------------------------------------------------------------
-- mess_cuts (§4.4)
--
-- Present in Phase 1 because the headcount projection subtracts approved cuts
-- (§8). The *policy* that governs them — advance notice, monthly cap, whether
-- partial-day cuts are allowed — is Phase 2 and still open (decisions D-05,
-- D-06). meal_slots[] models both whole-day and per-slot cuts, so neither
-- answer requires a migration.
-- ---------------------------------------------------------------------------

create table public.mess_cuts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  student_id      uuid not null references public.students (id) on delete cascade,
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,

  date_from  date not null,
  date_to    date not null,
  meal_slots public.meal_slot[] not null,

  requested_at   timestamptz not null default now(),
  -- The instant the cut takes effect; compared against now() + cut_advance_hours
  -- in the tenant's timezone.
  effective_from timestamptz not null,

  status               public.mess_cut_status not null default 'APPROVED',
  meals_credited       integer not null default 0,
  credit_amount_paise  bigint not null default 0,
  rejection_reason     text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint mess_cuts_dates_ordered check (date_to >= date_from),
  constraint mess_cuts_slots_not_empty check (array_length(meal_slots, 1) > 0),
  constraint mess_cuts_credit_nonneg
    check (meals_credited >= 0 and credit_amount_paise >= 0),
  constraint mess_cuts_rejection_has_reason
    check (status <> 'REJECTED' or length(btrim(coalesce(rejection_reason, ''))) > 0)
);

create index mess_cuts_tenant_student_range_idx
  on public.mess_cuts (tenant_id, student_id, date_from, date_to);
-- Serves the headcount projection, which asks "which cuts cover this date?"
create index mess_cuts_tenant_range_status_idx
  on public.mess_cuts (tenant_id, date_from, date_to, status);

create trigger mess_cuts_set_updated_at
  before update on public.mess_cuts
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- headcount_snapshots (§8) — the kitchen's locked number
--
-- The whole purpose of the advance-notice rule is to make this count
-- freezable. Once locked_at is set, the number is what the kitchen cooked to,
-- and the post-service variance report compares it against actual attendance.
-- ---------------------------------------------------------------------------

create table public.headcount_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants (id) on delete cascade,
  service_date       date not null,
  meal_slot          public.meal_slot not null,
  projected_count    integer not null,
  guest_count        integer not null default 0,
  extra_plate_count  integer not null default 0,
  locked_at          timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint headcount_tenant_date_slot_key unique (tenant_id, service_date, meal_slot),
  constraint headcount_counts_nonneg
    check (projected_count >= 0 and guest_count >= 0 and extra_plate_count >= 0)
);

create index headcount_tenant_date_idx on public.headcount_snapshots (tenant_id, service_date);

create trigger headcount_snapshots_set_updated_at
  before update on public.headcount_snapshots
  for each row execute function app.set_updated_at();

-- A locked snapshot is the kitchen's committed number and must not drift
-- afterwards. The cron job is idempotent and re-runnable (§9), so it will
-- attempt to rewrite this row; that attempt must be a no-op, not a silent
-- change to a number someone already cooked to.
create or replace function app.protect_locked_headcount()
returns trigger
language plpgsql
as $$
begin
  if old.locked_at is not null then
    if new.projected_count is distinct from old.projected_count
       or new.guest_count is distinct from old.guest_count
       or new.extra_plate_count is distinct from old.extra_plate_count
       or new.locked_at is distinct from old.locked_at then
      raise exception 'headcount snapshot for % % is locked and cannot be changed',
        old.service_date, old.meal_slot
        using errcode = 'object_not_in_prerequisite_state';
    end if;
  end if;
  return new;
end;
$$;

create trigger headcount_snapshots_protect_locked
  before update on public.headcount_snapshots
  for each row execute function app.protect_locked_headcount();

-- ---------------------------------------------------------------------------
-- rate_limits (§12)
--
-- "rate-limit /api/qr/token (per student) and /api/qr/verify (per device)".
-- Kept in Postgres rather than in process memory because the app runs on
-- serverless instances that do not share memory — an in-memory limiter there
-- is security theatre. Fixed-window counters; good enough to stop abuse
-- without the complexity of a sliding log.
-- ---------------------------------------------------------------------------

create table public.rate_limits (
  bucket_key   text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,

  constraint rate_limits_pkey primary key (bucket_key, window_start)
);

create index rate_limits_window_idx on public.rate_limits (window_start);

-- Atomic increment-and-test. Returns true when the request is allowed.
-- The INSERT ... ON CONFLICT DO UPDATE is what makes this race-free under the
-- concurrent scans of a real meal service.
create or replace function app.consume_rate_limit(
  p_bucket_key      text,
  p_window_seconds  integer,
  p_max_requests    integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_start timestamptz;
  v_count        integer;
begin
  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limits (bucket_key, window_start, request_count)
  values (p_bucket_key, v_window_start, 1)
  on conflict (bucket_key, window_start)
  do update set request_count = public.rate_limits.request_count + 1
  returning request_count into v_count;

  return v_count <= p_max_requests;
end;
$$;

revoke execute on function app.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function app.consume_rate_limit(text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.plans               enable row level security;
alter table public.subscriptions       enable row level security;
alter table public.menus               enable row level security;
alter table public.attendance          enable row level security;
alter table public.mess_cuts           enable row level security;
alter table public.headcount_snapshots enable row level security;
alter table public.rate_limits         enable row level security;

-- rate_limits: no policies. Service role only — a client that could read or
-- write this table could erase its own limit.

-- plans: every member sees the tenant's plans (students need to choose one);
-- only admins change them.
create policy plans_read on public.plans
  for select to authenticated
  using (tenant_id = app.current_tenant_id());

create policy plans_admin_write on public.plans
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());

-- subscriptions: a student sees their own; staff and admins see the tenant's.
create policy subscriptions_read_own on public.subscriptions
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and student_id = app.current_student_id());

create policy subscriptions_read_tenant on public.subscriptions
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_staff_or_admin());

create policy subscriptions_admin_write on public.subscriptions
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());

-- menus: every member reads; only admins publish.
create policy menus_read on public.menus
  for select to authenticated
  using (tenant_id = app.current_tenant_id());

create policy menus_admin_write on public.menus
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());

-- attendance: a student sees their own history; staff and admins see the
-- tenant's. Staff may record attendance (that is their job) but may not delete
-- it — an erased scan is an unfalsifiable claim of "I never ate".
create policy attendance_read_own on public.attendance
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and student_id = app.current_student_id());

create policy attendance_read_tenant on public.attendance
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_staff_or_admin());

create policy attendance_staff_insert on public.attendance
  for insert to authenticated
  with check (tenant_id = app.current_tenant_id() and app.is_staff_or_admin());

create policy attendance_admin_update on public.attendance
  for update to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());

-- mess_cuts: a student sees and requests their own; admins see and manage all.
create policy mess_cuts_read_own on public.mess_cuts
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and student_id = app.current_student_id());

create policy mess_cuts_read_tenant on public.mess_cuts
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_staff_or_admin());

create policy mess_cuts_admin_write on public.mess_cuts
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());

-- headcount_snapshots: staff and admins read (it is the kitchen's number);
-- only the service role writes, via the locking cron job.
create policy headcount_read on public.headcount_snapshots
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_staff_or_admin());

-- ---------------------------------------------------------------------------
-- Realtime
--
-- Drives the live bulk count on the staff dashboard (§8). Publishing only
-- attendance keeps the realtime payload small; RLS still applies to realtime
-- subscribers, so a student cannot listen to the whole tenant's scans.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.attendance;
