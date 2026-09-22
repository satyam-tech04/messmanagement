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

### D-03 — Mid-cycle joiners are pro-rated — ⚠️ formula superseded by D-17

**Decided:** 2026-07-25. The first invoice covers only the remaining days of the cycle.

**Superseded 2026-08-30 by D-17** (see [new_features/TRACKER.md](new_features/TRACKER.md)).
The _principle_ stands — a student who joins on the 18th does not pay for the whole month
— but the arithmetic has changed:

|          | Old (D-03)                                  | Current (D-17)                  |
| -------- | ------------------------------------------- | ------------------------------- |
| Rate     | per **meal**, `floor(price ÷ slots × days)` | per **day**, `price ÷ duration` |
| Rounding | down; remainder stays with the mess         | up, to the whole rupee          |

**Why it changed:** the per-day figure is the one an admin can explain to a student or a
parent at the counter — "seventeen of thirty days" — where the per-meal derivation needs
the slot count explained first. The remainder still never favours the student: rounding
_up_ keeps the mess whole in the same direction D-03's floor did.

**Where it lives now:** `assignmentPricePaise` in `src/core/policies/pricing.policy.ts`,
in exact integer paise. The per-meal rate is still derived — `perMealPaise` — but only for
mess-cut credits, and now from what the student actually paid rather than the full plan
price, so a discounted student is never credited more per skipped meal than they paid.

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

**Note:** the repo/product is named `mealadda`, deliberately not after this one
tenant. It is a multi-tenant SaaS; naming the codebase after the first customer
would contradict the whole design.

### D-05 — Mess-cut cap shape

**Decided:** 2026-08-15. **Per calendar month**, resetting on the 1st.

**Why:** a pooled quarterly allowance lets absences bunch — exam week arrives and half the
hostel goes home at once — and the headcount projection is the product's main claim. A
monthly reset keeps the worst case bounded and is also the rule a student can hold in their
head without a running total.

**Consequence:** a skip request may not span a month boundary; `requestAbsence` refuses one
with a message telling the student to submit two. `daysUsedInMonth` counts a **set of
dates**, so a cut crossing the boundary contributes only its days inside this month, and two
overlapping cuts never consume the same day twice. Away periods are exempt — see below.

**Still configurable:** the cap's _value_ lives in `tenant_settings.cut_max_days_per_month`
(0–31) and is editable in Settings, so a mess can loosen or tighten it without a deploy.

### D-06 — Partial-day cuts

**Decided:** 2026-08-15. **Configurable per mess**, via
`tenant_settings.allow_partial_day_skip`, defaulting to on.

**Why:** the right answer depends on how the mess cooks. A mess that cooks per meal saves
real money on a lunch-only skip; one that cooks per day saves nothing from it and just gets
a more complicated count. Forcing either rule on both would be wrong for one of them.

**Consequence:** the cap counts in **days**, not meals, under both settings — a day on which
a student skips anything is a day spent. That keeps one number on screen ("3 of 5 days
left") rather than a meals-vs-days figure nobody can reconcile. With partial skipping off,
the student's form fixes every meal on their plan as selected, visibly rather than silently.

### D-14 — Being away is not the same as skipping, and is not capped

**Decided:** 2026-08-15. Two kinds of absence share the `mess_cuts` table: **SKIP** (short,
self-service, capped) and **AWAY** (a planned period, reviewed by the admin, uncapped).

**Why:** one cap cannot serve both. A five-day monthly allowance would block a student going
home for a fortnight, which is entirely legitimate and should not be penalised. Sending
those to the admin instead also gives the kitchen warning of a large drop in the headcount,
which a silent self-service cut would not.

**Mechanics:** `allow_away_requests` and `away_requires_approval` are separate toggles, both
off/on independently of skipping. An AWAY always covers every meal the mess serves — nobody
is present for half a day. `away_advance_hours` is separate from `cut_advance_hours`, since
a fortnight away is worth knowing about earlier than tonight's dinner. `away_max_days`
(1–400) caps a single request so a mistyped date cannot cancel a whole term in one click.

**Consequence:** `mess_cut_status` gained **PENDING**. Only APPROVED and CREDITED remove a
plate from the headcount — cooking for a student who turns up is a small waste, not cooking
for one who is here is the failure the product exists to prevent. PENDING nonetheless
consumes the monthly allowance while it waits, or a student could spend the same five days
repeatedly while the admin is deciding.

### D-30 — The website is for admins; students and staff use the app (15 Sep 2026)

**Decision:** web sign-in is for mess admins and the platform operator. Students and
counter staff sign in on the MealAdda app.

**Held behind a switch.** `WEB_SIGNIN_APP_ONLY` (server env, default `false`). The app is
still reaching Campus Crave's phones, and turning this on early would leave a live hostel
with no web QR codes and no web counter. The owner turns it on per deployment once the app
is in hand (RUNBOOK §6a).

**When on:** the login form refuses STUDENT/STAFF _after_ the password check (so the
message confirms nothing to a guesser) and revokes that one session locally; the app
layout turns away sessions that predate the switch with a "use the app" screen. Admins
keep `/staff` for rush-hour counter work. The mobile API is untouched.

**Rule:** `canSignInOnWeb` in `operator-access.policy.ts`. Sign-out on the web is now
`scope: "local"` — signing out of a browser must not sign the same person out of the app.

### D-31 — The operator can work as admin, staff or a specific student (15 Sep 2026)

**Decision:** after signing in, `superuser` lands on `/superuser` and picks a persona.
Admin and staff need nothing new (the operator already passes both gates; staff screens
show the counter nav with "Back to admin"). **Student** means entering one real
student's account, because a student screen is one student's day.

**Mechanism:** a one-time sign-in link generated with the service role and verified on
the server swaps the operator's session for the student's. The operator's own tokens are
kept in an httpOnly cookie for Exit, beside a signed, session-bound, two-hour marker that
(a) shows the banner and (b) exempts the session from the forced password change. The
student's own phone stays signed in; Exit revokes only the added session.

**Confined like the mess switcher:** SUPER_ADMIN only; students only;
the operator's **current** mess only (another mess answers NOT_FOUND); active accounts
only. `IMPERSONATION_START`, `IMPERSONATION_FAILED` and `IMPERSONATION_END` are written to
that mess's audit trail. The change-password action refuses while impersonating.

**Rejected:** a read-only "preview as student" rendered with the service role — it would
need a second data path behind every student page, and a second path is where a
cross-tenant read eventually slips in.

### D-32 — A student deletes their own account in the app; the mess erases it (21 Sep 2026)

Both stores require account deletion to be startable inside the app. Until now there
was no delete-student feature at all: /delete-account promised an email to support,
actioned by hand.

**Decision.** A student confirms in the app by typing DELETE. Three things follow:

1. **Access stops immediately** — `profiles.status = 'DISABLED'`, which every endpoint
   already fails closed on, so the tokens on the phone die on their next request.
2. **The mess erases them within 30 days**, from a queue at `/admin/account-deletions`.
   The mess verifies its own student, which is what the published policy says happens.
3. **Erasure anonymises; it never deletes a row.** `profiles.id` cascades from
   `auth.users`, `students.profile_id` from `profiles`, and attendance, subscriptions,
   mess cuts, feedback and counter bills all cascade from `students` — so deleting a
   login would silently take a year of the mess's accounts with it.

**Only a student may ask.** A mess employee's login belongs to the mess, and an admin
who erased themselves from a phone would leave a hostel with no way back in.

**Blocked immediately, rather than after 30 days.** It is what Apple expects to see, and
it makes the promise unambiguous. The cost is a mis-tap locking a student out of meals
they have paid for, so an admin can cancel a request and the statuses go back to exactly
what they were — a student who was BLOCKED when they asked stays blocked afterwards.

**Rejected:** erasing on the spot with no queue. Nobody would verify the request was
genuine, and the mess would lose its only way to contact a student who still owes money.

**Rejected:** a cancel button in the app. Whoever asked is signed out, so there is nobody
to press it — cancellation is the mess's, at the student's request.

### D-33 — The app checks it is still allowed to run (21 Sep 2026)

`/api/app-version` returns the oldest build the API still supports (`MIN_APP_BUILD`).
An older app shows a blocking update screen instead of its own UI.

**Decision, and why it ships in 1.0.** This cannot be added later. The only thing that
can tell an installed app to update is code already inside it, so a release without this
can never require an upgrade — a future breaking change would simply start failing on
every phone that never updated, three times a day, at a counter.

**Fails open.** Rule 7 says fail closed on security and money; this is neither. A counter
on dropped wifi that could not reach the endpoint would show every student an update
screen mid-service. Unreachable means "carry on"; only an explicit answer blocks.

**`updateUrl` comes from the server**, because the store listings do not exist yet and
pointing at them must not require the very update being demanded.

### D-35 — The app is configured from the server, not the build (22 Sep 2026)

A store release is days of review, and some students never update. So anything that
might plausibly need changing is read from the server at launch: `platform_config`, a
single row edited at `/superuser/app-config` by the **SUPER_ADMIN only** — these are
decisions about our app across every mess, not one mess's settings.

Configurable today without a release: ads on/off, which of the four student screens
carry a banner, the ad unit ids per platform, test vs live mode, and the minimum
supported build (moved off an env var so it needs no deploy either).

**Ads fail closed.** Unreadable config, a platform with no unit, or an app id pasted
where a unit id belongs all mean no ads. The update gate fails the other way — open —
because blocking a student from their meals over a network blip is the worse error.

**The AdMob app id cannot be remote.** Android reads it through a ContentProvider and
iOS from Info.plist, both before any Dart runs, and a missing one crashes the app at
launch — before it could ask the server anything. It lives in `app.config.json` and is
generated into both platform files, so changing it is one line plus a rebuild.

**Every request is child-directed and non-personalised** (`AgeRestrictedTreatment.child`,
`nonPersonalizedAds`, content rating G), for every user, because some messes serve
minors and the app cannot know any individual's age.

**Sample ids ship today.** The real AdMob account is suspended until early October, so
`app.config.json` carries Google's public sample app ids, which serve test banners and
earn nothing. `npm run verify:release-ads` refuses a release while they remain.

---

## Open — must be answered before Phase 2

### D-07 — Unused credits at subscription end

Carry forward to renewal, expire, or refund? Architecture doc §14.3. Phase 2.

### D-08 — Cancellation & refund policy

Mid-cycle cancellation is currently undefined. Architecture doc §14.6. Phase 2.

### D-09 — Guest token pricing

Flat, or varying by meal slot? Architecture doc §14.4. Phase 3.
