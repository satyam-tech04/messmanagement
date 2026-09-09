-- ============================================================================
-- 018 — A mess shows its own name and logo to its own members
--
-- Once someone signs in they are inside *their hostel's* app, not ours. The
-- MessOS mark stays on the store listing and the login screen — the two places
-- a person has not yet identified which mess they belong to — and everywhere
-- after that shows the tenant's own identity.
--
-- The name already exists on `tenants`. This adds the logo.
--
-- Deliberately only the logo, and deliberately NOT a per-tenant colour. Colours
-- would mean re-verifying every contrast pairing in the app for every hostel
-- that ever signs up, and one of them would eventually choose something
-- unreadable on a counter tablet under kitchen lighting. The theme follows our
-- brand; the identity follows theirs.
-- ============================================================================

alter table public.tenants
  add column logo_path text;

comment on column public.tenants.logo_path is
  'Object path in the `tenant-logos` bucket, laid out as {tenant_id}/logo. NULL until the mess uploads one, in which case its name is shown as text.';

-- ---------------------------------------------------------------------------
-- tenant-logos bucket
--
-- Private, like every other bucket here, and served through an API route that
-- checks the session. A mess's logo is not secret, but a public bucket is an
-- enumerable list of every customer we have.
--
-- Objects are `{tenant_id}/logo`, so the first path segment IS the tenancy
-- boundary and the policies enforce it in the database rather than trusting
-- application code (rule 8).
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tenant-logos',
  'tenant-logos',
  false,
  -- 1 MB. A logo displayed at 96px does not need more, and the limit is
  -- enforced by storage rather than by a hopeful client-side check.
  1048576,
  array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
)
on conflict (id) do nothing;

-- Every signed-in member of the mess sees their own mess's logo.
create policy tenant_logos_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'tenant-logos'
    and (storage.foldername(name))[1] = app.current_tenant_id()::text
  );

-- Only an admin may set it. A logo is how a student tells at a glance that they
-- are in the right hostel's app, so staff must not be able to change it.
create policy tenant_logos_admin_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'tenant-logos'
    and (storage.foldername(name))[1] = app.current_tenant_id()::text
    and app.is_admin()
  );

create policy tenant_logos_admin_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'tenant-logos'
    and (storage.foldername(name))[1] = app.current_tenant_id()::text
    and app.is_admin()
  );

create policy tenant_logos_admin_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'tenant-logos'
    and (storage.foldername(name))[1] = app.current_tenant_id()::text
    and app.is_admin()
  );
