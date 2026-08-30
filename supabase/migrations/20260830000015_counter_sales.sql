-- ============================================================================
-- 015 — Counter sales: the walk-in billing pad ("à la carte")
--
-- A cash register for people buying food outside a meal plan. Standalone by
-- decision D-16: a bill carries a person's NAME as free text and nothing else.
-- No customer record, no history across visits, no link to a student. Two bills
-- bearing the same name are unrelated rows.
--
-- ## Naming
--
-- Not `bills`, and emphatically not "billing". The admin sidebar already has a
-- Billing entry reserved for Phase 2 subscription invoices and Razorpay, and
-- two screens called Billing showing unrelated totals is how an owner ends up
-- unable to say what the mess earned. The catalogue is `counter_items`, not
-- "menu items", because `menus` already means the daily published menu and
-- plans separately carry included meal slots.
--
-- ## Numbering is per mess, not global
--
-- The source spec asked for "a single continuous sequence for the lifetime of
-- the system". On a multi-tenant system that is wrong: two messes would
-- interleave BILL-000001, BILL-000002 between them and each owner's book would
-- show gaps they cannot explain. Both counters live on `tenants` and are
-- advanced under a row lock, exactly as migration 010 does for roll numbers.
--
-- ## service_date, not the timestamp
--
-- Revenue is keyed to a plain DATE derived in the mess's timezone. India is
-- UTC+5:30, so taking the date off `finalized_at` would file every bill
-- finalised between midnight and 05:30 local under the previous day -- a
-- nightly error for a mess that serves dinner.
-- ============================================================================

create type public.bill_status as enum ('OPEN', 'FINALIZED', 'CANCELLED');
create type public.bill_payment_status as enum ('UNPAID', 'PAID');

-- ---------------------------------------------------------------------------
-- The catalogue
-- ---------------------------------------------------------------------------

create table public.counter_items (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  -- System-generated (C001, C002...), unique per mess, never reused for a
  -- different item even after deactivation -- old bills still show it.
  item_code   text not null,
  item_name   text not null,
  unit        text not null,
  price_paise bigint not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint counter_items_tenant_code_key unique (tenant_id, item_code),
  constraint counter_items_name_not_blank check (length(btrim(item_name)) > 0),
  constraint counter_items_unit_not_blank check (length(btrim(unit)) > 0),
  -- Zero is not "free", it is a price nobody filled in.
  constraint counter_items_price_positive check (price_paise > 0)
);

create index counter_items_tenant_active_idx on public.counter_items (tenant_id, is_active);

create trigger counter_items_set_updated_at
  before update on public.counter_items
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Bills
-- ---------------------------------------------------------------------------

create table public.counter_bills (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  bill_number text not null,
  -- Free text. NOT a customer record -- see D-16 and spec §13.
  person_name text not null,

  status         public.bill_status not null default 'OPEN',
  payment_status public.bill_payment_status not null default 'UNPAID',

  -- Locked at finalisation from the line snapshots, never typed.
  total_paise bigint not null default 0,

  -- The mess's own calendar day, derived in its timezone at finalisation.
  -- Revenue groups on THIS, never on finalized_at.
  service_date date,

  created_by         uuid references public.profiles (id) on delete set null,
  finalized_at       timestamptz,
  finalized_by       uuid references public.profiles (id) on delete set null,
  cancelled_at       timestamptz,
  cancelled_by       uuid references public.profiles (id) on delete set null,
  payment_updated_by uuid references public.profiles (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint counter_bills_tenant_number_key unique (tenant_id, bill_number),
  constraint counter_bills_person_not_blank check (length(btrim(person_name)) > 0),
  constraint counter_bills_total_nonneg check (total_paise >= 0),
  -- A finalised bill has a day and an instant; an open one has neither. This is
  -- what stops a half-finalised row appearing in, or vanishing from, revenue.
  constraint counter_bills_finalized_shape check (
    (status = 'FINALIZED' and finalized_at is not null and service_date is not null)
    or (status <> 'FINALIZED' and finalized_at is null and service_date is null)
  ),
  constraint counter_bills_cancelled_shape check (
    (status = 'CANCELLED') = (cancelled_at is not null)
  ),
  -- Only a finalised bill can be marked paid. An open bill is still being
  -- built and a cancelled one was never owed.
  constraint counter_bills_paid_only_when_finalized check (
    payment_status = 'UNPAID' or status = 'FINALIZED'
  )
);

-- The staff screen's main query: every open bill in this mess.
create index counter_bills_tenant_open_idx
  on public.counter_bills (tenant_id, created_at desc)
  where status = 'OPEN';

-- The admin's daily revenue query.
create index counter_bills_tenant_service_date_idx
  on public.counter_bills (tenant_id, service_date)
  where status = 'FINALIZED';

create trigger counter_bills_set_updated_at
  before update on public.counter_bills
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Bill lines
--
-- Every *_snapshot is a copy taken when the line was created and never changes.
-- Rendering a bill uses only these -- never a join to counter_items, which may
-- since have been repriced, renamed or deactivated. That is spec §12, and it is
-- the difference between a receipt and a guess.
-- ---------------------------------------------------------------------------

create table public.counter_bill_items (
  id      uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  bill_id uuid not null references public.counter_bills (id) on delete cascade,
  -- Traceability only. Never read to recompute a historical value, and
  -- deliberately ON DELETE SET NULL so removing an item cannot blank a bill.
  counter_item_id uuid references public.counter_items (id) on delete set null,

  item_code_snapshot text   not null,
  item_name_snapshot text   not null,
  unit_snapshot      text   not null,
  unit_price_paise   bigint not null,
  quantity           integer not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint counter_bill_items_quantity_positive check (quantity between 1 and 999),
  constraint counter_bill_items_price_positive check (unit_price_paise > 0)
);

create index counter_bill_items_bill_idx on public.counter_bill_items (bill_id);

-- One line per item PER PRICE on a bill.
--
-- This is what makes the merge rule safe under two staff adding the same item
-- at the same instant: the second INSERT is refused and the caller increments
-- instead. Price is part of the key on purpose -- after a price change a bill
-- may legitimately carry a ₹60 line and a ₹70 line for the same item, and the
-- ₹60 one must stay exactly as the customer was quoted it.
create unique index counter_bill_items_bill_item_price_key
  on public.counter_bill_items (bill_id, counter_item_id, unit_price_paise);

create trigger counter_bill_items_set_updated_at
  before update on public.counter_bill_items
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Per-mess counters, advanced under a row lock (migration 010's pattern)
-- ---------------------------------------------------------------------------

alter table public.tenants
  add column next_bill_number        bigint not null default 1,
  add column next_counter_item_code  bigint not null default 1;

alter table public.tenants
  add constraint tenants_next_bill_number_positive check (next_bill_number >= 1),
  add constraint tenants_next_counter_item_code_positive check (next_counter_item_code >= 1);

comment on column public.tenants.next_bill_number is
  'Next counter-sale bill number for this mess. Allocated only through public.allocate_bill_number(), which increments it under a row lock. Never read-then-written from application code.';

create or replace function public.allocate_bill_number(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allocated bigint;
begin
  update public.tenants
     set next_bill_number = next_bill_number + 1
   where id = p_tenant_id
  returning next_bill_number - 1 into v_allocated;

  if v_allocated is null then
    raise exception 'no mess with id %', p_tenant_id
      using errcode = 'no_data_found';
  end if;

  return 'BILL-' || lpad(v_allocated::text, 6, '0');
end;
$$;

revoke execute on function public.allocate_bill_number(uuid) from public, anon, authenticated;
grant execute on function public.allocate_bill_number(uuid) to service_role;

create or replace function public.allocate_counter_item_code(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allocated bigint;
begin
  update public.tenants
     set next_counter_item_code = next_counter_item_code + 1
   where id = p_tenant_id
  returning next_counter_item_code - 1 into v_allocated;

  if v_allocated is null then
    raise exception 'no mess with id %', p_tenant_id
      using errcode = 'no_data_found';
  end if;

  return 'C' || lpad(v_allocated::text, 3, '0');
end;
$$;

revoke execute on function public.allocate_counter_item_code(uuid) from public, anon, authenticated;
grant execute on function public.allocate_counter_item_code(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Atomic quantity increment
--
-- The merge half of spec §5. A read-modify-write of the whole line loses an
-- update when two staff add to the same bill at once, and A13's "last write
-- wins" is the wrong default for THIS counter: all open bills are a shared
-- pool, and flaky counter Wi-Fi is a documented fact of this deployment.
-- Incrementing inside the UPDATE costs nothing and removes the class of bug.
-- ---------------------------------------------------------------------------

create or replace function public.increment_bill_line(p_line_id uuid, p_delta integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quantity integer;
begin
  update public.counter_bill_items i
     set quantity = i.quantity + p_delta
   where i.id = p_line_id
     -- Only while the bill is still open. A finalised bill is somebody's
     -- receipt, and this is the last place that could quietly alter one.
     and exists (
       select 1 from public.counter_bills b
        where b.id = i.bill_id and b.status = 'OPEN'
     )
  returning i.quantity into v_quantity;

  return v_quantity;
end;
$$;

revoke execute on function public.increment_bill_line(uuid, integer) from public, anon;
grant execute on function public.increment_bill_line(uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- RLS
--
-- Staff run the counter, so they read and write bills. Only admins touch the
-- catalogue and its prices (spec §14: staff never see a price field). Students
-- have no access at all -- these are not their records, and D-16 means a bill
-- is never "theirs" even when it bears their name.
-- ---------------------------------------------------------------------------

alter table public.counter_items      enable row level security;
alter table public.counter_bills      enable row level security;
alter table public.counter_bill_items enable row level security;

create policy counter_items_read on public.counter_items
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_staff_or_admin());

create policy counter_items_admin_write on public.counter_items
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());

create policy counter_bills_staff_all on public.counter_bills
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_staff_or_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_staff_or_admin());

create policy counter_bill_items_staff_all on public.counter_bill_items
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_staff_or_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_staff_or_admin());

comment on table public.counter_bills is
  'Walk-in cash bills. person_name is free text and is NOT a customer record (D-16): two bills with the same name are unrelated. Revenue groups on service_date, never on finalized_at.';
