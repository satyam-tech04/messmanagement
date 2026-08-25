-- ============================================================================
-- 012 — One mobile number, one student
--
-- Migration 011 added the generated `mobile` column but deliberately left it
-- non-unique, because Campus Crave held a duplicate that would have made this
-- index fail to build: two rows for one person, four seconds apart, each
-- carrying its own ACTIVE ₹5,200 subscription. That was not only a login
-- problem — it was billing him twice. The duplicate has since been removed and
-- the deletion recorded in `audit_log` with the full row it destroyed.
--
-- With the mobile number now serving as a student's username, a second student
-- holding it means NEITHER can sign in: the login flow refuses an ambiguous
-- number rather than guessing which account to open. That refusal is the right
-- behaviour and stays, but it is a poor place to discover the problem — the
-- student finds out at the counter, and the admin finds out from the student.
-- This index moves the discovery to the moment somebody tries to create the
-- collision.
--
-- Scoped to students. Staff and admins sign in with email, so their phone
-- number is contact information and two of them may legitimately share one —
-- a husband-and-wife pair running a small mess is not far-fetched.
--
-- Partial on `mobile is not null`, so the students who have no number on file
-- do not all collide with each other on NULL. Those students cannot sign in at
-- all until an admin adds their number, which is the intended behaviour: a
-- placeholder number would be worse than none, because the mobile number is
-- also the initial password — a dummy value would be a publicly guessable
-- credential pair for a real student's account.
-- ============================================================================

create unique index profiles_tenant_mobile_key
  on public.profiles (tenant_id, mobile)
  where role = 'STUDENT' and mobile is not null;

comment on index public.profiles_tenant_mobile_key is
  'A mobile number identifies exactly one student within a mess. Per-tenant, not global: two hostels may each have a student whose number is the same, and the login flow resolves the tenant from the number before signing anyone in.';
