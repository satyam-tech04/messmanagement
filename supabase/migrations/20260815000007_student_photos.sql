-- Student photos.
--
-- §6.3: "Staff must see the student's name and photo on success. The QR proves
-- possession of a phone, not identity. The human check at the counter closes
-- that gap and costs nothing."
--
-- The scanner has always rendered a photo when one was present; nothing could
-- ever set one. Until now a student could hand their phone to a friend and the
-- counter had no way to tell.
--
-- The bucket is **private**. These are photographs of named minors and young
-- adults in a hostel; a public bucket would make every one of them retrievable
-- by anyone who guessed a URL, forever, with no audit trail. Files are read
-- through `/api/students/[id]/photo`, which checks the caller's session first.
--
-- Objects are laid out as `{tenant_id}/{student_id}`, so the first path segment
-- IS the tenancy boundary and the policies below can enforce it in the database
-- rather than trusting application code (rule 8).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'student-photos',
  'student-photos',
  false,
  -- 2 MB. A counter photo is a headshot; anything larger is a mistake, and the
  -- limit is enforced by storage rather than by hopeful client-side checks.
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Any signed-in member of the tenant may look at their own mess's photos. Staff
-- need this at the counter; the admin needs it on the student's page.
create policy student_photos_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'student-photos'
    and (storage.foldername(name))[1] = app.current_tenant_id()::text
  );

-- Only an admin may add, replace or remove one. A counter device that could
-- overwrite a photo could also defeat the identity check it exists to support.
create policy student_photos_admin_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'student-photos'
    and (storage.foldername(name))[1] = app.current_tenant_id()::text
    and app.is_admin()
  );

create policy student_photos_admin_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'student-photos'
    and (storage.foldername(name))[1] = app.current_tenant_id()::text
    and app.is_admin()
  );

create policy student_photos_admin_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'student-photos'
    and (storage.foldername(name))[1] = app.current_tenant_id()::text
    and app.is_admin()
  );

-- The column already exists, on `profiles` rather than `students` — a person
-- has a photograph, and a student row is that person's enrolment in a mess.
comment on column public.profiles.photo_url is
  'Storage object path within the private student-photos bucket, laid out as {tenant_id}/{student_id}. Never a public URL: photos are served through /api/students/[id]/photo, which authorises the caller first.';
