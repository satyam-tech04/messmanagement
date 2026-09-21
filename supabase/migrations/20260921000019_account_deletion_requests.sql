-- ============================================================================
-- 019 — A student can ask to be deleted, from inside the app (D-32)
--
-- Both stores require it, and until now there was no delete-student feature at
-- all: /delete-account promised an email to support that somebody would action
-- by hand against this database.
--
-- The shape of the promise decides the shape of this table:
--
--   * **Access stops the moment they confirm.** That is `profiles.status =
--     'DISABLED'`, which `getSessionUserFromToken` already fails closed on, so
--     existing access tokens die on their next request too. This table records
--     what the statuses were beforehand, because an admin who cancels a request
--     must be able to put the student back exactly as they were — and a student
--     who was already INACTIVE must not be reactivated by being un-deleted.
--
--   * **Erasure happens within 30 days**, and erasure means *anonymisation*.
--     Nothing here deletes a row. `profiles.id` cascades from `auth.users`,
--     `students.profile_id` from `profiles`, and attendance, subscriptions,
--     mess cuts, feedback and counter bills all cascade from `students` — so
--     deleting a login would silently take a year of the mess's accounts with
--     it. The rows stay; the person is written out of them.
--
-- One open request per person, enforced by a partial unique index rather than
-- an application check (rule 5): the confirm button is on a phone with mess
-- wifi behind it, and a double tap must leave exactly one row.
-- ============================================================================

create type public.deletion_request_status as enum ('REQUESTED', 'COMPLETED', 'CANCELLED');

create table public.account_deletion_requests (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  -- Denormalised so the admin queue can name the student after erasure has
  -- removed the name from `profiles`. Kept deliberately: the mess needs to know
  -- it completed a request, and this is the audit trail that proves it did.
  student_id uuid references public.students (id) on delete set null,

  status public.deletion_request_status not null default 'REQUESTED',

  requested_at timestamptz not null default now(),
  -- A plain date in the tenant's own timezone (rule 9), not a timestamp: the
  -- promise is "within 30 days", which is a calendar fact for the hostel.
  erase_by date not null,

  -- What to restore on a cancellation. Without these, un-deleting a student who
  -- had already left the hostel would hand them a working login.
  previous_profile_status public.profile_status not null,
  previous_student_status public.student_status,

  decided_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null,
  -- Why an admin cancelled, or how they verified the person. Shown in the queue.
  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint account_deletion_note_length check (note is null or length(note) <= 500),
  -- A decided request records who decided and when; an open one records neither.
  constraint account_deletion_decided_together check (
    (status = 'REQUESTED' and decided_at is null)
    or (status <> 'REQUESTED' and decided_at is not null)
  )
);

-- The idempotency guarantee. A retried confirm hits this and the service reports
-- the existing request as the success it is.
create unique index account_deletion_one_open_idx
  on public.account_deletion_requests (tenant_id, profile_id)
  where status = 'REQUESTED';

-- The admin queue: open requests first, oldest deadline at the top, because the
-- oldest is the one closest to breaking the 30-day promise.
create index account_deletion_tenant_status_idx
  on public.account_deletion_requests (tenant_id, status, erase_by);

create trigger account_deletion_requests_set_updated_at
  before update on public.account_deletion_requests
  for each row execute function app.set_updated_at();

comment on table public.account_deletion_requests is
  'In-app "delete my account" requests. Access is revoked on request; erasure anonymises profiles and students within 30 days and never deletes rows, because attendance and billing cascade from them.';

-- ---------------------------------------------------------------------------
-- RLS
--
-- A student reads their own request and nothing else; they never write here
-- directly, because requesting also disables their profile and that pair has to
-- happen together, server-side. Admins read their mess's queue. Every write goes
-- through the service role, which is the only actor that can disable a profile.
-- ---------------------------------------------------------------------------

alter table public.account_deletion_requests enable row level security;

create policy account_deletion_read_own on public.account_deletion_requests
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and profile_id = auth.uid());

create policy account_deletion_read_tenant on public.account_deletion_requests
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin());
