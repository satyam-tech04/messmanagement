# Decision Log

Product and architecture decisions, with the reasoning that produced them. A decision here
outranks a guess in code. Open items block the phase named in their row.

---

## Resolved

### D-01 — MVP is Phase 0 + Phase 1 only

**Decided:** 2026-07-25. Attendance, menu, plans and headcount ship first; the money layer
(Phase 2) follows.

**Consequence:** the client keeps billing on paper for the pilot. All Phase 1 schema is
nonetheless written money-ready (`price_paise_snapshot` on subscriptions, `mess_cuts`
table present for headcount) so Phase 2 adds tables rather than rewriting them.

### D-02 — Students authenticate with admin-issued credentials

**Decided:** 2026-07-25. Chosen over phone OTP (per-SMS cost, needs an SMS provider) and
self-serve email signup (throwaway addresses, password-reset support load).

**Mechanics:** the admin creates the student with a roll number and a generated temporary
password. Supabase Auth requires an email, so each student gets a deterministic synthetic
address derived from tenant slug + roll number; the student never sees or types it. Login
takes **roll number + password**. `profiles.must_change_password` forces a reset on first
login.

**Consequence:** no student-initiated signup path exists — this is intentional, and it also
removes a whole class of tenant-enumeration abuse. Password resets go through the admin.
A real email/phone is still captured on the profile for future notifications.

### D-03 — Mid-cycle joiners are pro-rated

**Decided:** 2026-07-25. The first invoice covers only the remaining days of the cycle,
priced at the plan's per-meal rate.

**Why:** it reuses the exact per-meal derivation that mess-cut credits already require
(architecture doc §7.1), so it is nearly free to implement, and it avoids the
"student joins on the 18th and pays full price" dispute that would otherwise become a
manual ledger adjustment every month.

**Encoded in:** `BillingPolicy` (Phase 2). The remainder-stays-with-the-mess invariant
applies here too.

### D-04 — Supabase is a hosted project; no local Docker stack

**Decided:** 2026-07-25 by the project owner. Migrations apply directly to the hosted
project via `supabase db push`.

**Risk accepted:** a bad migration reaches live student data with no rehearsal. Mitigated
by `scripts/check-migrations.mjs` (applied migrations become immutable) and by writing
every migration to be additive and reversible.

**Recommended follow-up (not yet done):** provision a second free-tier Supabase project as
`dev` before real students are onboarded, and point `SUPABASE_PROJECT_REF` at it for
rehearsal. This is a one-line env change — the workflow already supports it.

### D-10 — `brace-expansion` advisory accepted rather than force-patched

**Decided:** 2026-07-25. `npm audit` reports a high-severity ReDoS in
`brace-expansion` with a range of `<=5.0.7`, meaning the maintainer patched only the
5.x line. Forcing `brace-expansion@5` breaks `minimatch@3` (used by
`eslint-plugin-import`) with `TypeError: expand is not a function`, which disables
ESLint entirely — including the import-boundary rules that enforce the layering.

**Decision:** accept the advisory. It is a **dev-only** transitive dependency of the
ESLint toolchain: it never ships to production, never runs at request time, and never
processes untrusted input. Trading a working architectural safety control for a
theoretical dev-time DoS is a bad exchange.

`postcss` and `sharp` **are** overridden to patched versions — those are compatible and
`sharp` does reach production via Next's image optimizer.

**Revisit when:** `minimatch@3` disappears from the tree (an `eslint-plugin-import`
update), or the fix is backported to the 1.x/2.x lines.

### D-11 — Credentials live in `.env`, never `.env.local`

**Decided:** 2026-07-25 by the project owner. All scripts read `.env` via
`scripts/load-env.mjs`.

**Why it needs stating:** Next.js gives `.env.local` _higher_ precedence than
`.env`. If both existed, the app would read one database while migrations
targeted another — a failure that looks like phantom data rather than a config
mistake. `load-env.mjs` warns if a `.env.local` ever appears.

### D-12 — The auth hook needs an RLS policy, not just a GRANT

**Discovered:** 2026-07-25, fixed in migration 003.

Migration 001 granted `supabase_auth_admin` SELECT on `public.profiles` and
enabled RLS on the same table. That combination silently produced JWTs with no
`tenant_id` or `user_role`: the hook is not `SECURITY DEFINER`, so it runs as
`supabase_auth_admin`, and **a GRANT does not bypass RLS**. With no matching
policy the lookup returned zero rows and the hook's null-guard skipped the
claims.

**Why it went unnoticed:** the RLS helpers fall back to a direct profile lookup
when the claim is absent, so authorization stayed _correct_ — it just cost an
extra query per policy check. Nothing errored. Only decoding a real issued token
revealed it.

**Chose the policy over `SECURITY DEFINER`:** it is Supabase's documented
approach, and it scopes the grant to SELECT-on-one-table rather than running the
function with owner privileges.

**Guarded by:** `npm run db:verify` now asserts both the policy's existence and
that a real sign-in produces populated claims.

### D-13 — Tenant slug is `unversity-mess`; display name keeps the typo

**Decided:** 2026-07-25 by the project owner. The Supabase project is named
`unversity_mess` (missing "i" in "university"). It will not be renamed, and the
codebase uses the same identity.

**One forced deviation:** `tenants.slug` has a `^[a-z0-9-]+$` constraint — no
underscores — because the slug becomes part of each student's synthetic login
address under D-02 (`{roll}@{slug}.invalid`). Underscores are invalid in DNS
hostnames and get rejected by email validators including Supabase Auth's.

So: **slug `unversity-mess`, display name `unversity_mess`.** Students never see
either — they log in with a roll number.

`scripts/verify-schema.mjs` asserts both that the underscore form is rejected and
that the hyphen form is accepted, so this cannot silently drift.

**Note:** the repo/product is named `mess-os`, deliberately not after this one
tenant. It is a multi-tenant SaaS; naming the codebase after the first customer
would contradict the whole design.

---

## Open — must be answered before Phase 2

### D-05 — Mess-cut cap shape 🔴

**Question:** for a quarterly subscription, is the cap 5 days per calendar month, or 15
days pooled across the quarter?

**Status:** awaiting product-owner input.

**Impact:** `MessCutPolicy` cap accounting. Per-month is stricter and makes headcount more
predictable; pooled is more generous but lets cuts bunch into one month, which weakens the
headcount projection that is the product's main selling point.

**Not blocking now:** the cap value lives in `tenant_settings`, never in code, so only the
_counting rule_ is undecided — not the schema.

### D-06 — Partial-day cuts 🔴

**Question:** may a student cut only lunch and still eat dinner, or is a cut always a whole
day?

**Status:** awaiting product-owner input.

**Impact:** if partial cuts are allowed, the cap must count in **meals**, not days, and the
mess-cut UI needs per-slot selection.

**Not blocking now:** `mess_cuts.meal_slots text[]` already models both. Whole-day cuts are
simply the case where the array holds every slot. No migration is needed either way.

### D-07 — Unused credits at subscription end

Carry forward to renewal, expire, or refund? Architecture doc §14.3. Phase 2.

### D-08 — Cancellation & refund policy

Mid-cycle cancellation is currently undefined. Architecture doc §14.6. Phase 2.

### D-09 — Guest token pricing

Flat, or varying by meal slot? Architecture doc §14.4. Phase 3.
