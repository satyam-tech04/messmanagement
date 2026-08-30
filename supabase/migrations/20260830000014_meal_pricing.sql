-- ============================================================================
-- 014 — Meal pricing: a rate card, and how a plan's price was arrived at
--
-- Three layers, each freezing what it needs when it is created:
--
--   meal_prices    the current rate card. Changing it affects only plans made
--                  afterwards.
--   plans          base premium, discount and final price, frozen at creation.
--   subscriptions  the plan's price and duration, copied at assignment, plus
--                  what this student was actually charged.
--
-- ## Additive, deliberately
--
-- The source spec described new `plans` and `assignments` tables. Both already
-- exist here — `assignments` is `subscriptions`, and the spec's
-- `status: Active | Retired` is the existing `is_active`. Building them as
-- written would have produced a second, parallel subscription system beside a
-- working one. So this migration only adds columns.
--
-- ## price_paise stays the single source of truth
--
-- The spec adds a `final_price` column. This does not, because every existing
-- reader — plan assignment, revenue reporting, the per-meal rate behind
-- mess-cut credits — already reads `plans.price_paise`. A second price column
-- would diverge from it the first time one was written without the other. So
-- `price_paise` IS the final price, and the two new columns record how it was
-- derived, with a CHECK that keeps them honest.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Layer 1 — the rate card
-- ---------------------------------------------------------------------------

create table public.meal_prices (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  meal_slot   public.meal_slot not null,
  price_paise bigint not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- One current rate per meal, per mess. History is not kept here: it is
  -- implicit in the frozen snapshots on plans and subscriptions, which is where
  -- anybody asking "what did this cost in March?" actually needs to look.
  constraint meal_prices_tenant_slot_key unique (tenant_id, meal_slot),
  -- Zero is rejected rather than treated as free. A meal with no price is a
  -- mess that has not finished configuring itself, and it would silently
  -- produce plans priced below what the food costs.
  constraint meal_prices_positive check (price_paise > 0)
);

create index meal_prices_tenant_idx on public.meal_prices (tenant_id);

create trigger meal_prices_set_updated_at
  before update on public.meal_prices
  for each row execute function app.set_updated_at();

alter table public.meal_prices enable row level security;

-- Staff read: the counter has no use for this, but the same repositories serve
-- both roles and a read policy costs nothing. Only admins set prices.
create policy meal_prices_read on public.meal_prices
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_staff_or_admin());

create policy meal_prices_admin_write on public.meal_prices
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());

-- ---------------------------------------------------------------------------
-- Layer 2 — how a plan's price was arrived at
-- ---------------------------------------------------------------------------

alter table public.plans
  add column base_premium_paise bigint,
  add column discount_paise     bigint not null default 0,
  -- Audit only. The rates used to suggest the base premium, kept so support can
  -- answer "why was this ₹3,600?" months later. NEVER read to recompute a
  -- price — that is the whole point of freezing base/discount above it.
  add column meal_prices_snapshot jsonb;

-- Backfill before the NOT NULL. Every existing plan was priced directly, with
-- no discount, so its base premium is its price and the identity below holds
-- for all 14 live rows.
update public.plans set base_premium_paise = price_paise where base_premium_paise is null;

alter table public.plans
  alter column base_premium_paise set not null;

alter table public.plans
  add constraint plans_base_premium_positive check (base_premium_paise > 0),
  add constraint plans_discount_nonneg check (discount_paise >= 0),
  -- The identity that stops the two representations drifting apart. Any write
  -- that changes one without the other is refused rather than silently
  -- producing a plan whose stated derivation does not match its price.
  add constraint plans_price_is_base_less_discount
    check (price_paise = base_premium_paise - discount_paise);

-- A free plan is a mistyped discount. Confirmed safe: no live plan is at zero.
alter table public.plans drop constraint plans_price_nonneg;
alter table public.plans add constraint plans_price_positive check (price_paise > 0);

comment on column public.plans.meal_prices_snapshot is
  'The meal rates used to suggest base_premium_paise, for support and audit only. Never read to recompute a price.';

-- ---------------------------------------------------------------------------
-- Layer 3 — what this student was actually charged
--
-- `price_paise_snapshot` already froze the plan price at assignment. These add
-- the duration the student actually bought, what the formula said it should
-- cost, and whether an admin overrode that.
-- ---------------------------------------------------------------------------

alter table public.subscriptions
  add column plan_duration_days_snapshot integer,
  add column assignment_duration_days    integer,
  add column calculated_price_paise      bigint,
  add column is_price_overridden         boolean not null default false;

-- Backfill from what actually happened. Every existing subscription was sold as
-- a full plan term at the plan's full price, so the assignment duration is the
-- plan duration and the calculated price is the price already frozen.
--
-- Deliberately NOT derived from (end_date - start_date + 1): migration 013 lets
-- a pause push end_date out, which would overstate the duration bought and make
-- the per-day rate wrong for any student who had been paused.
update public.subscriptions s
set plan_duration_days_snapshot = p.duration_days,
    assignment_duration_days    = p.duration_days,
    calculated_price_paise      = s.price_paise_snapshot
from public.plans p
where p.id = s.plan_id
  and s.plan_duration_days_snapshot is null;

alter table public.subscriptions
  alter column plan_duration_days_snapshot set not null,
  alter column assignment_duration_days set not null,
  alter column calculated_price_paise set not null;

alter table public.subscriptions
  add constraint subscriptions_plan_duration_positive
    check (plan_duration_days_snapshot between 1 and 400),
  add constraint subscriptions_assignment_duration_positive
    check (assignment_duration_days between 1 and 400),
  -- A student cannot be sold more days than the plan offers. Two terms is two
  -- subscriptions, each with its own frozen price.
  add constraint subscriptions_duration_within_plan
    check (assignment_duration_days <= plan_duration_days_snapshot),
  add constraint subscriptions_calculated_price_nonneg
    check (calculated_price_paise >= 0);

comment on column public.subscriptions.calculated_price_paise is
  'What the pro-rating formula produced at assignment. Kept even when overridden, so an admin discount is visible rather than invisible.';

comment on column public.subscriptions.assignment_duration_days is
  'Calendar days of the plan this student bought. Never derived from end_date, which a pause can move (migration 013).';
