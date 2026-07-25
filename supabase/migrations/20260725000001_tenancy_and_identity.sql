-- ============================================================================
-- 001 — Tenancy & Identity
--
-- Establishes the multi-tenant spine: tenants, their policy settings, their
-- per-tenant secrets, user profiles, students, and the audit log.
--
-- Architecture doc §4.1, §5. The rule that governs this whole file:
-- multi-tenancy is a data-model property, not a feature. Every business table
-- carries tenant_id, every index leads with it, and RLS enforces it a second
-- time in case application code is wrong.
-- ============================================================================

create extension if not exists "pgcrypto" with schema extensions;

-- A private schema for security helpers. Not exposed through PostgREST, so
-- these can never be called directly by a client.
create schema if not exists app;
revoke all on schema app from public, anon, authenticated;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enums — explicit state machines, never boolean soup (§2.6)
-- ---------------------------------------------------------------------------

create type public.tenant_type as enum ('HOSTEL', 'CLOUD_KITCHEN', 'BULK_SUPPLY');
create type public.tenant_status as enum ('ACTIVE', 'SUSPENDED', 'CANCELLED');
create type public.user_role as enum ('STUDENT', 'STAFF', 'ADMIN', 'SUPER_ADMIN');
create type public.profile_status as enum ('ACTIVE', 'DISABLED');

-- Student lifecycle. Legal transitions (guarded in core/domain):
--   ACTIVE  -> GRACE    (invoice past due, Phase 2)
--   GRACE   -> BLOCKED  (grace period elapsed, Phase 2)
--   GRACE   -> ACTIVE   (payment clears)
--   BLOCKED -> ACTIVE   (payment clears)
--   any     -> INACTIVE (left the hostel)
create type public.student_status as enum ('ACTIVE', 'GRACE', 'BLOCKED', 'INACTIVE');

-- A closed superset of realistic mess service slots. Which of these a tenant
-- actually serves is configured in tenant_settings.meal_slots, so this stays
-- configurable per §1.1 while keeping the column type-safe and indexable.
create type public.meal_slot as enum ('BREAKFAST', 'LUNCH', 'SNACKS', 'DINNER');

-- ---------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------

create or replace function app.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- A mistyped IANA zone would silently shift every service_date derivation by
-- hours, which is the single most confusing class of bug in this system (§2.9).
-- This has to be a trigger rather than a CHECK: timezone resolution is STABLE,
-- not IMMUTABLE, and CHECK constraints only accept IMMUTABLE expressions.
create or replace function app.assert_valid_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception '% is not a recognised IANA timezone name', new.timezone
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- tenants
-- ---------------------------------------------------------------------------

create table public.tenants (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null,
  name       text not null,
  type       public.tenant_type not null default 'HOSTEL',
  -- IANA zone, e.g. 'Asia/Kolkata'. Every service_date in this system is
  -- derived in this timezone, never in UTC (§2.9).
  timezone   text not null default 'Asia/Kolkata',
  status     public.tenant_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tenants_slug_key unique (slug),
  -- The slug becomes part of each student's synthetic login address, so keep it
  -- to a conservative DNS-safe alphabet.
  constraint tenants_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  constraint tenants_name_not_blank check (length(btrim(name)) > 0)
);

create trigger tenants_set_updated_at
  before update on public.tenants
  for each row execute function app.set_updated_at();

create trigger tenants_validate_timezone
  before insert or update of timezone on public.tenants
  for each row execute function app.assert_valid_timezone();

-- ---------------------------------------------------------------------------
-- tenant_settings — the policy store (§1.1)
--
-- "Every number in this table is a row in tenant_settings, never a constant in
-- code. The moment a rule is hardcoded, the second customer becomes a fork."
-- ---------------------------------------------------------------------------

create table public.tenant_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,

  -- [{"slot":"LUNCH","start":"12:00","end":"14:30"}, ...]
  -- Drives which slots exist, and the meal window enforced at QR verification.
  meal_slots jsonb not null default
    '[{"slot": "LUNCH", "start": "12:00", "end": "14:30"}, {"slot": "DINNER", "start": "19:30", "end": "22:00"}]'::jsonb,

  -- Mess-cut policy (Phase 2). Values, not code.
  cut_advance_hours      integer not null default 12,
  cut_max_days_per_month integer not null default 5,

  -- Dues policy (Phase 2).
  grace_period_days integer not null default 3,
  block_on_overdue  boolean not null default true,

  -- Extras (Phase 3).
  allow_extras            boolean not null default false,
  guest_token_price_paise bigint  not null default 0,
  extra_plate_price_paise bigint  not null default 0,

  -- QR rotation (§6.2). TTL is the validity window; refresh is how often the
  -- student's screen redraws. Refresh must stay strictly below TTL, or a
  -- student can be holding an already-dead code between redraws.
  qr_token_ttl_seconds integer not null default 30,
  qr_refresh_seconds   integer not null default 15,

  currency   text not null default 'INR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tenant_settings_meal_slots_is_array check (jsonb_typeof(meal_slots) = 'array'),
  constraint tenant_settings_meal_slots_not_empty check (jsonb_array_length(meal_slots) > 0),
  constraint tenant_settings_cut_advance_hours_sane check (cut_advance_hours between 0 and 720),
  constraint tenant_settings_cut_cap_sane check (cut_max_days_per_month between 0 and 31),
  constraint tenant_settings_grace_sane check (grace_period_days between 0 and 90),
  constraint tenant_settings_prices_nonneg
    check (guest_token_price_paise >= 0 and extra_plate_price_paise >= 0),
  constraint tenant_settings_qr_ttl_sane check (qr_token_ttl_seconds between 10 and 300),
  constraint tenant_settings_qr_refresh_lt_ttl
    check (qr_refresh_seconds > 0 and qr_refresh_seconds < qr_token_ttl_seconds),
  constraint tenant_settings_currency_format check (currency ~ '^[A-Z]{3}$')
);

create trigger tenant_settings_set_updated_at
  before update on public.tenant_settings
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- tenant_secrets — per-tenant QR signing key (§5.3)
--
-- Deliberately separate from tenant_settings: settings are readable by every
-- member of the tenant, and this must never be. RLS is enabled with NO
-- policies, so only the service role (which bypasses RLS) can read it. An admin
-- who could read their own signing secret could mint attendance for any student.
-- ---------------------------------------------------------------------------

create table public.tenant_secrets (
  tenant_id         uuid primary key references public.tenants (id) on delete cascade,
  qr_signing_secret text not null,
  rotated_at        timestamptz not null default now(),
  created_at        timestamptz not null default now(),

  constraint tenant_secrets_strength check (length(qr_signing_secret) >= 32)
);

-- ---------------------------------------------------------------------------
-- profiles — extends auth.users
-- ---------------------------------------------------------------------------

create table public.profiles (
  id        uuid primary key references auth.users (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  role      public.user_role not null default 'STUDENT',
  full_name text not null,
  phone     text,
  -- Real, human-usable contact address. Distinct from the synthetic address in
  -- auth.users that students log in with (decision D-02) — that one is an
  -- implementation detail students never see or type.
  email     text,
  photo_url text,
  status    public.profile_status not null default 'ACTIVE',
  -- Set when an admin issues or resets a password; cleared once the user
  -- chooses their own. Gates every route until resolved.
  must_change_password boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_full_name_not_blank check (length(btrim(full_name)) > 0),
  constraint profiles_phone_format check (phone is null or phone ~ '^\+?[0-9]{7,15}$')
);

create index profiles_tenant_role_idx on public.profiles (tenant_id, role);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- students
-- ---------------------------------------------------------------------------

create table public.students (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  roll_number text not null,
  block       text,
  room_number text,
  joined_at   date not null default current_date,
  status      public.student_status not null default 'ACTIVE',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint students_profile_key unique (profile_id),
  constraint students_roll_not_blank check (length(btrim(roll_number)) > 0)
);

-- The roll number is what staff type into the manual fallback with a queue
-- waiting, so it must be unambiguous within a tenant. Case-insensitive
-- uniqueness makes 'cs21b001' and 'CS21B001' the same student rather than two.
-- Done with an expression index rather than citext to avoid depending on the
-- extensions schema being on the role's search_path.
create unique index students_tenant_roll_key
  on public.students (tenant_id, lower(roll_number));

create index students_tenant_status_idx on public.students (tenant_id, status);

create trigger students_set_updated_at
  before update on public.students
  for each row execute function app.set_updated_at();

-- A student's profile must live in the same tenant as the student row.
-- Without this, a cross-tenant profile_id would let one tenant's RLS check pass
-- against data that belongs to another.
create or replace function app.assert_student_profile_same_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_tenant uuid;
begin
  select tenant_id into v_profile_tenant from public.profiles where id = new.profile_id;
  if v_profile_tenant is distinct from new.tenant_id then
    raise exception 'profile % belongs to tenant %, not %',
      new.profile_id, v_profile_tenant, new.tenant_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger students_profile_tenant_match
  before insert or update of profile_id, tenant_id on public.students
  for each row execute function app.assert_student_profile_same_tenant();

-- ---------------------------------------------------------------------------
-- audit_log (§4.4)
--
-- Written for exactly the actions that become disputes: manual payment entry,
-- manual attendance override, price changes, block/unblock, settings changes,
-- ledger adjustments.
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete cascade,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  action           text not null,
  entity_type      text not null,
  entity_id        uuid,
  before           jsonb,
  after            jsonb,
  ip               inet,
  user_agent       text,
  created_at       timestamptz not null default now(),

  constraint audit_log_action_not_blank check (length(btrim(action)) > 0)
);

create index audit_log_tenant_created_idx on public.audit_log (tenant_id, created_at desc);
create index audit_log_tenant_entity_idx on public.audit_log (tenant_id, entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Security helpers (§5.2)
--
-- These read the custom JWT claims injected by the auth hook below, so RLS
-- costs no extra query per row. The fallback profile lookup keeps the system
-- correct if the hook has not been enabled in the dashboard yet — a missing
-- claim then degrades to one cached lookup rather than silently returning zero
-- rows everywhere, which is miserable to debug.
-- ---------------------------------------------------------------------------

create or replace function app.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id', '')::uuid,
    (select p.tenant_id from public.profiles p where p.id = auth.uid())
  );
$$;

-- NOTE: the claim is `user_role`, not `role`. Supabase already uses the `role`
-- claim for the Postgres role (`authenticated`/`anon`); overwriting it would
-- break PostgREST authorization entirely.
create or replace function app.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'user_role', '')::public.user_role,
    (select p.role from public.profiles p where p.id = auth.uid())
  );
$$;

create or replace function app.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.current_user_role() = 'SUPER_ADMIN';
$$;

create or replace function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.current_user_role() in ('ADMIN', 'SUPER_ADMIN');
$$;

create or replace function app.is_staff_or_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.current_user_role() in ('STAFF', 'ADMIN', 'SUPER_ADMIN');
$$;

-- The current user's student row, if any. Used by student-scoped policies.
create or replace function app.current_student_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id from public.students s where s.profile_id = auth.uid();
$$;

grant execute on function
  app.current_tenant_id(), app.current_user_role(), app.is_super_admin(),
  app.is_admin(), app.is_staff_or_admin(), app.current_student_id()
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Custom access token hook (§5.2)
--
-- Injects tenant_id and user_role into every issued JWT so RLS reads them for
-- free. MUST be enabled in the dashboard:
--   Authentication → Hooks → Customize Access Token (JWT) Claims
--   → public.custom_access_token_hook
-- ---------------------------------------------------------------------------

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_claims    jsonb;
  v_tenant_id uuid;
  v_role      public.user_role;
begin
  select p.tenant_id, p.role
    into v_tenant_id, v_role
    from public.profiles p
   where p.id = (event ->> 'user_id')::uuid;

  v_claims := coalesce(event -> 'claims', '{}'::jsonb);

  if v_tenant_id is not null then
    v_claims := jsonb_set(v_claims, '{tenant_id}', to_jsonb(v_tenant_id::text));
    v_claims := jsonb_set(v_claims, '{user_role}', to_jsonb(v_role::text));
  end if;

  return jsonb_set(event, '{claims}', v_claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant select on public.profiles to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Layer 2 of the two-layer model (§5.1). The application layer remains
-- responsible for role authorization ("staff may verify attendance but not
-- issue refunds") — RLS protects rows, it cannot express that.
-- ---------------------------------------------------------------------------

alter table public.tenants         enable row level security;
alter table public.tenant_settings enable row level security;
alter table public.tenant_secrets  enable row level security;
alter table public.profiles        enable row level security;
alter table public.students        enable row level security;
alter table public.audit_log       enable row level security;

-- tenant_secrets intentionally has NO policies. RLS-enabled with zero policies
-- denies every authenticated request; only service_role reaches it.

-- tenants: members read their own tenant; only super admins write.
create policy tenants_read_own on public.tenants
  for select to authenticated
  using (id = app.current_tenant_id() or app.is_super_admin());

create policy tenants_super_admin_write on public.tenants
  for all to authenticated
  using (app.is_super_admin())
  with check (app.is_super_admin());

-- tenant_settings: every member reads (the student app needs meal windows and
-- QR rotation values); only admins change policy.
create policy tenant_settings_read on public.tenant_settings
  for select to authenticated
  using (tenant_id = app.current_tenant_id() or app.is_super_admin());

create policy tenant_settings_admin_write on public.tenant_settings
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());

-- profiles: you always read yourself; staff and admins read their tenant.
create policy profiles_read_self on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_read_tenant on public.profiles
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_staff_or_admin());

-- Self-service updates are column-limited by the trigger below, not by this
-- policy — Postgres policies cannot restrict which columns change.
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_admin_write on public.profiles
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());

-- A student must not be able to promote themselves to ADMIN, move tenants, or
-- re-enable a disabled account by writing to their own profile row.
create or replace function app.guard_profile_self_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The service role (auth.uid() is null) and admins go through normally, as
  -- does anyone updating a row that is not their own.
  if auth.uid() is null or auth.uid() <> new.id or app.is_admin() then
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id
     or new.role is distinct from old.role
     or new.status is distinct from old.status then
    raise exception 'a user may not change their own tenant, role, or status'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger profiles_guard_self_update
  before update on public.profiles
  for each row execute function app.guard_profile_self_update();

-- students: a student reads their own row; staff and admins read the tenant.
create policy students_read_self on public.students
  for select to authenticated
  using (profile_id = auth.uid());

create policy students_read_tenant on public.students
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_staff_or_admin());

create policy students_admin_write on public.students
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());

-- audit_log: admins read their tenant's trail. Nobody updates or deletes it,
-- and writes go through the service role so an actor cannot forge or suppress
-- their own audit entry.
create policy audit_log_admin_read on public.audit_log
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin());
