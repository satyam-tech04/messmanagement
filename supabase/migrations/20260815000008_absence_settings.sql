-- Student absences: skipping a meal, and being away.
--
-- The `mess_cuts` table already models both — a day off is a cut covering every
-- meal slot, and a period away is one with a wider date range — so this adds no
-- new table. What it adds is the tenant's control over whether students may do
-- either at all, and under what rules.
--
-- Two distinct things, deliberately, because one cap cannot serve both:
--
--   * **Skipping** is short and self-service, and is what the monthly cap is
--     for. Without a cap students would only pay for meals they ate, while the
--     mess's costs — wages, rent, gas — are already spent.
--
--   * **Being away** is a planned absence of several days. A five-day cap would
--     block a student going home for a fortnight, which is legitimate and
--     should not be penalised. These go to the admin, who both approves them
--     and decides whether they count against the cap. The kitchen also gets
--     warning of a large absence, which a silent self-service cut would not
--     give it.
--
-- Everything here defaults to OFF. A mess that has not thought about its policy
-- should not discover students skipping meals because a deploy enabled it.

-- An away request waits for a human decision, which the enum had no value for:
-- it began at APPROVED, which is exactly what an unreviewed request is not.
--
-- Added before it is used anywhere. Postgres refuses to use a new enum value in
-- the same transaction that created it, so nothing below may reference PENDING.
alter type public.mess_cut_status add value if not exists 'PENDING' before 'APPROVED';

alter table public.tenant_settings
  add column allow_meal_skipping   boolean not null default false,
  -- When false a student may only skip a whole day, never a single meal. Some
  -- messes cook per-day rather than per-meal, so a lunch-only skip saves them
  -- nothing and just complicates the count.
  add column allow_partial_day_skip boolean not null default true,
  add column allow_away_requests    boolean not null default false,
  -- Away periods normally need a human decision; a mess that trusts its
  -- students can turn that off and have them approved on submission.
  add column away_requires_approval boolean not null default true,
  -- Separate from cut_advance_hours: a fortnight away is worth knowing about
  -- earlier than tonight's dinner.
  add column away_advance_hours     integer not null default 24,
  -- A ceiling on a single request, so a mistyped date cannot cancel a whole
  -- term's meals in one click.
  add column away_max_days          integer not null default 30;

alter table public.tenant_settings
  add constraint tenant_settings_away_advance_sane
    check (away_advance_hours between 0 and 720),
  add constraint tenant_settings_away_max_days_sane
    check (away_max_days between 1 and 400);

comment on column public.tenant_settings.allow_meal_skipping is
  'Students see no way to skip a meal until this is on. Off by default: a mess that has not set its policy should not find students skipping because of a deploy.';

comment on column public.tenant_settings.allow_away_requests is
  'Longer planned absences, reviewed by the admin rather than self-service, so the kitchen gets warning of a large drop in the headcount.';

-- A student may cancel their own request, so the state machine needs the
-- CANCELLED transition to be reachable from PENDING as well as APPROVED.
comment on column public.mess_cuts.status is
  'PENDING when awaiting admin review, APPROVED once it counts against the headcount, REJECTED with a reason, CANCELLED if withdrawn. Only APPROVED and CREDITED remove a plate from the count.';
