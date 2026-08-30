-- ============================================================================
-- 016 — Special-meal announcements, and student feedback
--
-- Two small features, each behind its own per-mess toggle.
--
-- ## Announcements
--
-- The owner posts "Onam Sadhya this Sunday"; every student in that mess sees
-- it. Per D-19 that is the whole feature: no opt-in, no headcount, no charge,
-- no effect on eligibility or the QR flow. A mess that charges for a special
-- meal rings it up through counter sales (migration 015), which is deliberately
-- unconnected to this.
--
-- Visibility is DERIVED from the date window, never stored. Nothing in this
-- system runs on a schedule beyond the headcount snapshot, so a stored "is
-- live" flag would need a job that does not exist. The same reasoning produced
-- `subscription-state.ts` and `pause.policy.ts`.
--
-- ## Feedback
--
-- This is the one place a student may put something INTO the system. The
-- standing rule is that the student app is read-only — show a QR, view details,
-- view notifications — and feedback is the single exception the owner asked
-- for, because only the person who ate the food can rate it.
--
-- It is contained accordingly: gated by a toggle that defaults to OFF, one
-- verdict per student per meal enforced by a unique index, and it touches
-- nothing operational. No eligibility, no attendance, no headcount, no money.
--
-- Photos live in a PRIVATE bucket. A student photographing their lunch will
-- sometimes photograph the people around them, and this is a hostel full of
-- young adults; a public bucket would make every one of those retrievable by
-- anyone who guessed a URL, forever. Same decision as migration 007 made for
-- student photos, for the same reason.
-- ============================================================================

create type public.announcement_status as enum ('PUBLISHED', 'ARCHIVED');

-- ---------------------------------------------------------------------------
-- Per-mess toggles
--
-- Announcements default ON: posting one is harmless and a mess that never does
-- simply has an empty list. Feedback defaults OFF: it is the only student input
-- in the product, and turning it on should be a decision somebody made rather
-- than something that appeared after a deploy.
-- ---------------------------------------------------------------------------

alter table public.tenant_settings
  add column allow_announcements boolean not null default true,
  add column allow_feedback      boolean not null default false;

comment on column public.tenant_settings.allow_feedback is
  'When true, students may rate a meal and attach a photo. The single student input in the product, off by default. Enforced in feedback.policy.ts as well as the UI.';

-- ---------------------------------------------------------------------------
-- Announcements
-- ---------------------------------------------------------------------------

create table public.announcements (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,

  title text not null,
  body  text,

  -- The day the special meal is served, when it is about one day in particular.
  -- Null for a standing notice. Plain dates, derived in the mess's timezone.
  service_date date,
  meal_slot    public.meal_slot,

  -- The window it shows in, inclusive at BOTH ends -- an announcement about
  -- Sunday lunch must still be on screen on Sunday.
  starts_on date not null,
  ends_on   date not null,

  status public.announcement_status not null default 'PUBLISHED',

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint announcements_title_not_blank check (length(btrim(title)) > 0),
  constraint announcements_window_ordered check (ends_on >= starts_on)
);

-- Serves the student screen: "what is live in my mess today?"
create index announcements_tenant_window_idx
  on public.announcements (tenant_id, starts_on, ends_on)
  where status = 'PUBLISHED';

create trigger announcements_set_updated_at
  before update on public.announcements
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Feedback
-- ---------------------------------------------------------------------------

create table public.meal_feedback (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,

  service_date date not null,
  meal_slot    public.meal_slot not null,

  rating  integer not null,
  comment text,
  -- Object path in the private `meal-feedback` bucket, or null. Read through an
  -- authenticated route, never linked directly.
  photo_path text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint meal_feedback_rating_range check (rating between 1 and 5),
  constraint meal_feedback_comment_length check (comment is null or length(comment) <= 1000),

  -- One verdict per student per meal. A constraint rather than an application
  -- check, so re-submitting replaces an answer instead of stacking a second one
  -- and the admin's averages cannot be moved by whoever taps hardest.
  constraint meal_feedback_one_per_meal unique (tenant_id, student_id, service_date, meal_slot)
);

-- The admin's list: a day's feedback, worst first so the complaints are on top.
create index meal_feedback_tenant_date_idx
  on public.meal_feedback (tenant_id, service_date desc, rating);

create trigger meal_feedback_set_updated_at
  before update on public.meal_feedback
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.announcements enable row level security;
alter table public.meal_feedback enable row level security;

-- Every member of the mess reads announcements -- that is the point of them.
create policy announcements_read on public.announcements
  for select to authenticated
  using (tenant_id = app.current_tenant_id());

create policy announcements_admin_write on public.announcements
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());

-- A student sees only their own feedback, and may write only their own row.
-- Without the `student_id` check on INSERT, a student could post a five-star
-- review in somebody else's name.
create policy meal_feedback_read_own on public.meal_feedback
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and student_id = app.current_student_id());

create policy meal_feedback_write_own on public.meal_feedback
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and student_id = app.current_student_id())
  with check (tenant_id = app.current_tenant_id() and student_id = app.current_student_id());

-- Staff and admins read all of it; that is the review screen.
create policy meal_feedback_read_tenant on public.meal_feedback
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_staff_or_admin());

-- ---------------------------------------------------------------------------
-- Feedback photos
--
-- Private, and laid out as `{tenant_id}/{student_id}/{service_date}-{slot}`, so
-- the first path segment IS the tenancy boundary and the policies enforce it in
-- the database rather than trusting application code (rule 8).
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'meal-feedback',
  'meal-feedback',
  false,
  -- 3 MB. A phone photo of a plate, not a print master.
  3145728,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Staff and admins look at the photos on the review screen; a student may see
-- their own mess's, which includes their own.
create policy meal_feedback_photos_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'meal-feedback'
    and (storage.foldername(name))[1] = app.current_tenant_id()::text
  );

-- A student may only write under their OWN student id -- the second path
-- segment. Without this, any signed-in student could overwrite another's photo.
create policy meal_feedback_photos_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'meal-feedback'
    and (storage.foldername(name))[1] = app.current_tenant_id()::text
    and (
      (storage.foldername(name))[2] = app.current_student_id()::text
      or app.is_staff_or_admin()
    )
  );

create policy meal_feedback_photos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'meal-feedback'
    and (storage.foldername(name))[1] = app.current_tenant_id()::text
    and (
      (storage.foldername(name))[2] = app.current_student_id()::text
      or app.is_staff_or_admin()
    )
  );

create policy meal_feedback_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'meal-feedback'
    and (storage.foldername(name))[1] = app.current_tenant_id()::text
    and app.is_admin()
  );

comment on table public.meal_feedback is
  'One rating per student per meal. The only place a student writes to this system; gated by tenant_settings.allow_feedback, which defaults to false.';
