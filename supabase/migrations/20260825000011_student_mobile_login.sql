-- ============================================================================
-- 011 — Students sign in with their mobile number
--
-- Roll numbers were the student's username (D-02). They are being replaced by
-- the mobile number, which every student already knows and never mistypes.
--
-- The auth identity itself does NOT change. Each student's Supabase Auth
-- address is still derived from their roll number
-- (`3@campus-crave.mess.invalid`), because rewriting hundreds of auth users
-- would be a migration with no way back. What changes is the *lookup*: the
-- login form resolves a mobile number to that student, then signs in as the
-- address it already had. Roll numbers become internal — the counter's manual
-- fallback identifier — rather than something a student types.
--
-- Matching on a phone number typed by a human is the whole difficulty. The
-- office may have stored `+91 98765-43210`, `09876543210` or `9876543210` for
-- the same person, and the student will type whichever they remember. Rather
-- than teach every query to normalise, the normalised form is a GENERATED
-- column: Postgres maintains it, it can be indexed, and it cannot drift out of
-- step with `phone` the way a trigger-maintained copy eventually would.
--
-- The last ten digits, matching `temporaryPasswordFromPhone` — which derives a
-- student's initial password from the same digits. Those two rules are now
-- load-bearing together and must not be allowed to diverge; both go through
-- `normalizeMobile` in `src/core/domain/identity.ts`.
--
-- NOTE: uniqueness is deliberately NOT enforced here. Campus Crave currently
-- has one duplicate (two rows sharing 9209489179), and a unique index would
-- fail to build. Migration 012 adds it once that is resolved. Until then the
-- login flow refuses an ambiguous number rather than guessing — the same rule
-- it already applies to a roll number found in two messes.
-- ============================================================================

alter table public.profiles
  add column mobile text generated always as (
    case
      when length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) >= 10
        then right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10)
      else null
    end
  ) stored;

comment on column public.profiles.mobile is
  'The last ten digits of `phone`, maintained by Postgres. The student login key: the form resolves this to a student, then signs in as their roll-number-derived auth address. NULL when no usable ten-digit number is on file, which is exactly the set of students who cannot sign in.';

-- Login resolution runs before any session exists, on every student sign-in
-- attempt, and must not degrade into a sequential scan as the platform grows.
-- Deliberately not tenant-scoped: at this point in the flow the tenant is not
-- known yet — resolving the number is how it gets discovered.
create index profiles_mobile_idx
  on public.profiles (mobile)
  where role = 'STUDENT' and mobile is not null;
