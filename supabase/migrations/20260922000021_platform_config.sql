-- ============================================================================
-- 021 — Configuration the app reads at runtime (D-35)
--
-- The principle: **a store release should be rare, and only for genuinely new
-- code.** Anything that might plausibly need changing is read from the server
-- at launch instead of being compiled into the binary — because a compiled-in
-- value is a decision frozen until every student updates, and some never will.
--
-- One row, platform-wide, edited by the **SUPER_ADMIN only**. Deliberately not
-- per-tenant: these are our decisions about our app (where ads sit, which build
-- is too old), not a mess's decisions about its own operation. Those already
-- live in `tenant_settings`.
--
-- What must still be compiled in, and why it cannot live here:
--
--   * The **AdMob app id** — Android reads it from the manifest and iOS from
--     Info.plist, before any Dart runs. There is no runtime hook.
--   * The **API base URL** and Firebase config, for the same reason.
--
-- Everything else about ads — whether they run at all, which screens carry
-- them, which ad unit is used, whether we are in test mode — is here.
-- ============================================================================

create table public.platform_config (
  -- Singleton. A config table with two rows is a config table nobody can
  -- reason about, so the check makes a second row impossible rather than
  -- leaving it to whoever writes the next query.
  id smallint primary key default 1 check (id = 1),

  -- --- Ads (D-35) ---------------------------------------------------------
  --
  -- Off by default. Ads reach every student at once, so switching them on is
  -- a deliberate act, never the state a fresh database happens to be in.
  ads_enabled boolean not null default false,

  -- Which student screens carry a banner, by the app's own route names. A
  -- jsonb object rather than a column per screen: adding a screen should not
  -- need a migration, which is the whole point of this table.
  ads_placements jsonb not null default '{
    "qr": false,
    "menu": false,
    "plan": false,
    "more": false
  }'::jsonb,

  -- Per platform, because AdMob issues a different unit id for each. Null
  -- means "no unit configured", which the policy treats as ads off for that
  -- platform — never as a reason to fall back to somebody else's unit.
  ads_unit_android text,
  ads_unit_ios     text,

  -- Google's public test units, served instead of the real ones. ON by
  -- default: a real ad unit hit during development is invalid traffic, and
  -- enough of it gets an AdMob account suspended rather than warned.
  ads_test_mode boolean not null default true,

  -- --- The force-update gate (D-33) --------------------------------------
  --
  -- Moved off the environment variable so it can be raised without a deploy —
  -- the day a breaking change ships is the day nobody wants to wait for a
  -- build. `MIN_APP_BUILD` stays as the fallback when this row is unreachable.
  min_app_build integer not null default 0 check (min_app_build >= 0),

  -- --- Room for the next switch ------------------------------------------
  --
  -- Feature flags that have not been invented yet. A jsonb bag so the next
  -- "can we turn this off remotely?" is a one-line change in the policy rather
  -- than a migration, a type regeneration and a deploy.
  flags jsonb not null default '{}'::jsonb,

  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,

  constraint platform_config_unit_android_format check (
    ads_unit_android is null or ads_unit_android ~ '^ca-app-pub-[0-9]+/[0-9]+$'
  ),
  constraint platform_config_unit_ios_format check (
    ads_unit_ios is null or ads_unit_ios ~ '^ca-app-pub-[0-9]+/[0-9]+$'
  ),
  -- An ad unit id with a tilde is an *app* id pasted into the wrong box. It is
  -- the single easiest AdMob mistake to make, it produces no ads and no error,
  -- and the format check above is what catches it at the point of typing.
  constraint platform_config_placements_is_object check (
    jsonb_typeof(ads_placements) = 'object'
  ),
  constraint platform_config_flags_is_object check (jsonb_typeof(flags) = 'object')
);

create trigger platform_config_set_updated_at
  before update on public.platform_config
  for each row execute function app.set_updated_at();

-- The row exists from the start, with everything off. The app then always has
-- an answer to read, and "no config" never means "no app".
insert into public.platform_config (id) values (1);

comment on table public.platform_config is
  'Single row of runtime configuration for the mobile app (D-35): ads, placements, the minimum supported build. SUPER_ADMIN only. Read publicly through /api/app-config.';

-- ---------------------------------------------------------------------------
-- RLS
--
-- Nobody reads this directly. The app gets it through `/api/app-config`, which
-- serves a filtered view on the service role, and writes happen in a Server
-- Action that checks for SUPER_ADMIN. No policy is therefore the correct
-- number of policies: RLS on with none denies everyone, including a leaked
-- anon key.
-- ---------------------------------------------------------------------------

alter table public.platform_config enable row level security;
