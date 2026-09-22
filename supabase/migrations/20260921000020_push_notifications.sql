-- ============================================================================
-- 020 — Push notifications to students' phones (D-34)
--
-- Four things a student actually wants to be told: the mess posted an
-- announcement, their away request was decided, their plan is about to end, and
-- tomorrow's menu is up. Students only — counter staff are looking at the
-- scanner during service, not at a notification tray.
--
-- Three tables, each earning its place:
--
--   * `device_tokens` — where to send. One row per install, keyed by the token
--     itself: FCM reissues tokens and the same phone can reappear with a new
--     one, so `token` is the identity and `profile_id` is what it currently
--     belongs to. A student signing in on a friend's phone must move the token,
--     not duplicate it, or the friend keeps getting their notifications.
--
--   * `notification_deliveries` — what has already been sent. A fan-out to 300
--     students is not atomic, and the cron that drives plan reminders will be
--     retried. The dedupe key is a unique index, so a retry writes nothing and
--     nobody's phone buzzes twice for one event (rule 5).
--
--   * `profiles.notification_opt_outs` — what a student has switched off.
--     Per-kind, because "tomorrow's menu is up" every single day is the one
--     most likely to make someone turn the whole lot off at the OS level, and
--     a student who silences that must still hear that their plan has lapsed.
--
-- Tokens are personal data: they identify a device and can be pushed to. They
-- are deleted outright on account erasure (D-32), not anonymised — there is
-- nothing in a token worth keeping.
-- ============================================================================

create type public.device_platform as enum ('IOS', 'ANDROID');

create type public.notification_kind as enum (
  'ANNOUNCEMENT',
  'ABSENCE_DECISION',
  'PLAN_REMINDER',
  'MENU_PUBLISHED'
);

-- ---------------------------------------------------------------------------
-- device_tokens
-- ---------------------------------------------------------------------------

create table public.device_tokens (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,

  -- The identity of the row. FCM hands the same device a new token whenever it
  -- feels like it, and hands a reinstalled app a token another install used to
  -- hold — so an upsert on this column is what keeps one phone to one row.
  token    text not null,
  platform public.device_platform not null,

  -- What the app was when it last registered. Answers "is this failure only
  -- happening on old builds?" without a second table.
  app_build integer,

  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  constraint device_tokens_token_key unique (token),
  constraint device_tokens_token_not_blank check (length(btrim(token)) > 0),
  constraint device_tokens_token_length check (length(token) <= 512)
);

create index device_tokens_tenant_profile_idx
  on public.device_tokens (tenant_id, profile_id);

comment on table public.device_tokens is
  'Where to push. Keyed by the token itself, because FCM reissues tokens and a reinstall can inherit one. Deleted on account erasure (D-32).';

-- ---------------------------------------------------------------------------
-- notification_deliveries
-- ---------------------------------------------------------------------------

create table public.notification_deliveries (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind      public.notification_kind not null,

  -- Whatever makes this send unique: an announcement id, or a student and a
  -- date for the daily plan reminder. The unique index below is the guarantee
  -- that a retried cron run pushes nothing a second time.
  dedupe_key text not null,

  -- Sent to how many devices, and how many were rejected. Kept as counts, not
  -- rows: which device failed is an FCM concern, and a per-device log of every
  -- notification to every student is a lot of personal data for very little.
  sent_count   integer not null default 0,
  failed_count integer not null default 0,

  created_at timestamptz not null default now(),

  constraint notification_deliveries_key_not_blank check (length(btrim(dedupe_key)) > 0),
  constraint notification_deliveries_counts_sane check (sent_count >= 0 and failed_count >= 0)
);

create unique index notification_deliveries_dedupe_idx
  on public.notification_deliveries (tenant_id, kind, dedupe_key);

comment on table public.notification_deliveries is
  'One row per notification event, not per device. The unique dedupe key is what makes a retried send a no-op.';

-- ---------------------------------------------------------------------------
-- Opt-outs
--
-- An array on the profile rather than a table: there are four kinds, every
-- read of them is "does this student want this one", and a join for that is a
-- join nobody needs. The check constraint keeps the values honest — a typo'd
-- kind would silently mute nothing.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column notification_opt_outs text[] not null default '{}';

alter table public.profiles
  add constraint profiles_opt_outs_known check (
    notification_opt_outs <@ array[
      'ANNOUNCEMENT', 'ABSENCE_DECISION', 'PLAN_REMINDER', 'MENU_PUBLISHED'
    ]::text[]
  );

comment on column public.profiles.notification_opt_outs is
  'Notification kinds this person has switched off in the app. Empty means everything is on.';

-- ---------------------------------------------------------------------------
-- RLS
--
-- A student sees and removes their own device tokens; registering happens
-- server-side on the service role, because the row records which tenant the
-- token belongs to and that must never come from the client (rule 8).
-- Deliveries are operational records with no student-facing screen, so nobody
-- reads them under RLS at all.
-- ---------------------------------------------------------------------------

alter table public.device_tokens enable row level security;
alter table public.notification_deliveries enable row level security;

create policy device_tokens_read_own on public.device_tokens
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and profile_id = auth.uid());

create policy device_tokens_delete_own on public.device_tokens
  for delete to authenticated
  using (tenant_id = app.current_tenant_id() and profile_id = auth.uid());
