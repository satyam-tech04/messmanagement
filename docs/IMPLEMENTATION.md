# Implementation Tracker

Source of truth for _what is built_ and _what is next_. Update the status column in the
same commit as the work. Phases follow architecture doc §11.

**MVP = Phase 0 + Phase 1.** Phases 2–4 are scoped but deliberately not started.

Legend: ✅ done · 🚧 in progress · ⬜ not started · ⏸️ deferred by decision

---

## ▶ RESUME HERE — state as of 2026-08-25

**Read this first if you are picking the project up cold.** It is written to survive a lost
conversation: everything needed to continue correctly is here or linked from here.

### What is done and verified

| Area                                  | State                                                               |
| ------------------------------------- | ------------------------------------------------------------------- |
| Repo, tooling, CI, import boundaries  | ✅ `npm run verify` green                                           |
| Core domain (pure, no I/O)            | ✅ **839 tests**, 99%+ coverage                                     |
| Database schema                       | ✅ migrations 001–012 **applied + sealed** on the live project      |
| JWT auth hook                         | ✅ enabled and verified end-to-end                                  |
| Generated DB types                    | ✅ `src/infra/supabase/database.types.ts` (incl. RPC Functions)     |
| Infrastructure layer (`src/infra`)    | ✅ env, clients, HMAC signer, 7 repositories                        |
| **Phase 0 — auth and shells**         | ✅ **complete, both exit criteria proven**                          |
| Seeded demo data                      | ✅ 2 tenants, 10 students, plans, menus                             |
| UI foundation                         | ✅ shadcn/Base UI, design tokens, app shell, [DESIGN.md](DESIGN.md) |
| **Phase 1.2 — students, full CRUD**   | ✅ list, add, detail, edit, status change, password reset, audited  |
| **Phase 1.3 — plans & subscriptions** | ✅ plan CRUD, assign/end with price + meal-slot snapshot            |
| **Phase 1.4 — menus**                 | ✅ week planner, student view, service-state resolution             |
| **Phase 1.5b — student QR**           | ✅ rotating code, denial states, eligibility checked at issuance    |
| **Phase 1.6b — counter scanner**      | ✅ camera, distinct outcomes, manual fallback, offline queue        |
| **Phase 1.7b — live headcount**       | ✅ realtime count, snapshot cron with locking                       |
| **Phase 1.8 — exit criteria**         | ✅ **14 checks pass against the live DB** (`npm run verify:phase1`) |
| **MVP (Phase 0 + 1)**                 | ✅ **complete** — every nav route resolves                          |
| **Absences (skip / away)**            | ✅ policy, service, settings toggles, student + admin screens       |
| **First live client — Campus Crave**  | ✅ onboarded on the live project: 3 admins, 3 staff, 26 students    |
| **Platform operator (SUPER_ADMIN)**   | ✅ `superuser` login + mess switcher, 13 live checks pass           |
| **Students sign in with a mobile**    | ✅ generated `profiles.mobile`, login resolves it to their account  |
| **Auto-assigned roll numbers**        | ✅ per-mess toggle, allocated under a row lock (010)                |
| **Counter photo from the camera**     | ✅ getUserMedia capture, same upload action as a picked file        |
| **Mobile app — Slice 0 (transport)**  | ✅ `/api/*` reachable over a bearer token, 4 live checks pass       |

**Phase 0 is done.** Three roles sign in against the live database and land on their own
shell; cross-tenant isolation is proven with real data. Phase 1 domain logic (QR policy,
attendance verification, headcount projection) is already written and tested — what
remains is the screens and endpoints on top of it.

### Live client — Campus Crave (onboarded 2026-08-24)

The first paying mess. **This is production data**: 26 real students who eat three times a
day. `campus-crave` on the live Supabase project, `Asia/Kolkata`, four meal slots
(breakfast, lunch, snacks, dinner), 8 plans.

Provisioned by `scripts/onboard-campus-crave.ts`. Every account was created with
`must_change_password: true`, so the passwords below stop working the moment their owner
signs in and chooses their own — that is the flow working, not a fault. Harshal has
already done so.

| Role  | Email                            | Initial password    |
| ----- | -------------------------------- | ------------------- |
| Admin | `shraddha.admin@campuscrave.com` | `CampusAdmin@2026`  |
| Admin | `harshal.admin@campuscrave.com`  | _(already changed)_ |
| Admin | `admin@campuscrave.com`          | `CampusAdmin@2026`  |
| Staff | `roshni.staff@campuscrave.com`   | `CampusStaff@2026`  |
| Staff | `satish.staff@campuscrave.com`   | `CampusStaff@2026`  |
| Staff | `staff@campuscrave.com`          | `CampusStaff@2026`  |

### Platform operator — the `superuser` account

One login that can work in **any** mess, for supporting customers without holding a
password per hostel. Created by `npm run create:superadmin`.

Sign in with the bare word `superuser` (not an email) — `classifyLoginIdentifier` maps
that reserved word to the undeliverable address `superuser@messos.internal`, the same
trick student roll numbers use. Then: **sidebar → Platform → Messes → Switch**.

⚠️ The password is `superuser`, chosen deliberately by the owner. It is a nine-character
dictionary word guarding an account that can enter every tenant, including Campus Crave's
live students. `must_change_password` is `false` on this account by design — it is the one
login with no recovery path, so forcing a change would risk locking the platform out.
Re-running `npm run create:superadmin` resets it.

**How the cross-tenant access works, because it is not what it looks like.** The operator
is never granted sight of every tenant at once. Switching _moves their profile_ into the
chosen mess and re-issues their JWT from it, so at any instant they are an ordinary admin
of exactly one hostel and RLS confines them as tightly as it confines a real mess admin.
That is why this feature needed **no migration and no change to any of the 30 RLS
policies** protecting a live customer's data — there is no cross-tenant read path to get
wrong, because none was created. `SUPER_ADMIN` already existed in the `user_role` enum,
in `proxy.ts` role gates and in `homeRouteFor`; the schema anticipated this account.

The one privileged write — repointing `profiles.tenant_id` — is in
`SupabaseTenantDirectory.moveOperator` and carries `.eq("role", "SUPER_ADMIN")` in the
statement itself. With RLS bypassed by the service role, that filter is the only thing
preventing a bug there from relocating a real mess admin, or a student along with their
attendance history, into another hostel. Do not remove it.

### Student login — mobile number (revised D-02)

Students sign in with their **mobile number**, not their roll number. Staff and admins are
unchanged and still use email.

The auth identity did NOT change. Each student's Supabase Auth address is still derived
from their roll number (`3@campus-crave.mess.invalid`); the login form resolves the mobile
number to that student and signs in as the address they already had. Rewriting hundreds of
auth users would have been a migration with no way back.

`profiles.mobile` is a **generated column** holding the last ten digits, so `+91
98765-43210`, `09876543210` and `9876543210` are one student. That same normalisation is
the student's initial password, so `temporaryPasswordFromPhone` delegates to
`normalizeMobile` rather than reimplementing it — three copies of "the last ten digits"
would eventually disagree, and the symptom is a student handed a password that does not
open their own account.

⚠️ The mobile number is both the username and the first password, chosen deliberately by
the owner. `must_change_password` is what bounds it, and it must not be relaxed.

Uniqueness is enforced per mess by `profiles_tenant_mobile_key` (migration 012). Verified
against the live database: `9111100002`, `+919111100002` and `09111100002` all collide as
one student, another mess may hold the same number, and any number of students may have
none.

Note `profiles_phone_format` only permits `^\+?[0-9]{7,15}$`, so a number cannot be
_stored_ with spaces or hyphens. Normalisation still matters, because a student may **type**
`+91 98765-43210` at the login form and `normalizeMobile` resolves it.

**Students with no mobile number cannot sign in, deliberately.** No placeholder is written:
the mobile number is also the initial password, so a dummy value would be a publicly
guessable credential pair for a real student's account. The students list surfaces them — a
banner counting them tenant-wide, a `?missingMobile=1` filter, and an amber
"No mobile — cannot sign in" under the name — so the gap is visible rather than silent.
Five Campus Crave students are in this state: rolls 12, 13, 24, 25, 34.

**Resolved 2026-08-25 — the duplicate enrolment.** `9209489179` was on both _Sagar Gore_
(roll 11) and _Sagar Subhash gore_ (roll 31), created four seconds apart. Each carried its
own ACTIVE ₹5,200 subscription for the same plan and dates, so the mess was billing one
person ₹10,400. Neither could sign in, because the login refuses an ambiguous number. On the
owner's instruction roll 11 was deleted (`auth.users` delete, cascading to profile, student
and subscription) and roll 31 kept. The full deleted row is preserved in `audit_log` under
`STUDENT_DELETED_AS_DUPLICATE`.

### Auto-assigned roll numbers

Per-mess, under **Settings → Enrolment**, off by default. When on, the roll number column
disappears from both the single and bulk forms and the number is issued by
`public.allocate_roll_number()`.

That function increments `tenants.next_roll_number` inside an `UPDATE`, which takes a row
lock. This is not incidental: `max(roll_number) + 1` is read-then-write, the bulk form
creates 25 students in one submission and the CSV import creates hundreds, so two callers
would be handed the same number — and since the roll number is baked into the login
address, the second student would fail to be created halfway through a batch with auth
users already written. Verified against the live database: 10 concurrent calls returned 10
distinct, sequential numbers.

Counters were seeded above what each mess had already issued by hand — Campus Crave
continues at 68. (demo-hostel's counter sits at 11 rather than 1: ten numbers were consumed
proving the concurrency property. Gaps are harmless.)

### Demo logins (after `npm run db:seed`)

| Role    | Identifier                                 | Password      |
| ------- | ------------------------------------------ | ------------- |
| Admin   | `admin@unversity-mess.test`                | `MessOS@2026` |
| Staff   | `staff@unversity-mess.test`                | `MessOS@2026` |
| Student | `9000000003` (mobile number — Rohan Gupta) | `MessOS@2026` |

⚠️ **Do not use `CS21B001` or `CS21B002` to test student login.** Both exist in _both_
seeded tenants, and roll numbers are unique per tenant, not globally — so the login action
refuses to guess which hostel you meant and returns "That roll number exists at more than
one mess." That is correct behaviour, not a bug: logging a student into the wrong hostel
would show them another mess's data. Use `CS21B003`–`CS21B006`, `EE21B011` or `EE21B012`,
which exist in `unversity-mess` only.

A second tenant `demo-hostel` exists solely to prove isolation — its admin is
`admin@demo-hostel.test`, and it deliberately reuses `CS21B001`/`CS21B002`.
Remove everything with `npm run db:seed -- --reset`.

### Next steps, in order

**The MVP is complete.** Phase 1 exit criteria are proven — see below. What remains before
the pilot runs on it:

1. **Onboard the first client**: `npm run provision -- --name … --slug … --email …`
   creates a mess without touching any existing one. See RUNBOOK §"Onboarding a new
   mess" for the order to configure it in. Still outstanding before handover: error
   alerting, and making the repo private.
2. **Turn absences on for the pilot tenant.** They ship **off**, by design — Settings →
   _Skipping meals_ / _Time away_. Until then the student nav shows no Absences link and
   `/student/absences` 404s, which is the intended behaviour, not a bug.
3. **Reporting, and the remaining exports** — student import and export are built
   (`/admin/students/import`, `/admin/students/export`), as are the subscriptions and revenue
   exports under `/admin/reports`. Password delivery is solved — a student's first password is
   their own mobile number. Still to do: the renewals-due report, and the attendance /
   absence / headcount exports. Full plan: [IMPORT-EXPORT.md](IMPORT-EXPORT.md).
4. **Gaps 9–14 from the review**: audit-log viewer, student attendance history, plans empty
   states, cross-tenant roll-number login, email notifications.
5. **The deferred cleanup list** below — the repo is still public, and there is a general
   tidy-up pass outstanding.
6. **Widen the pilot's meal windows temporarily** if the client wants to test outside the
   configured IST windows. Scans are correctly refused outside them.
7. **Phase 2 (money)** — D-05 and D-06 are now settled (see DECISIONS.md); the remaining
   blockers are the ledger and Razorpay, not product questions.

### Deferred to the end, by the user's instruction

- The GitHub repo is still **Public** and should be Private before real student data.
- The first two commits carry a `Co-Authored-By: Claude` trailer; later ones do not.
- General cleanup pass.

### Live project facts

- Supabase project `yenxlcrtlmnfotfqqabo` — name `unversity_mess`, **free tier**, ap-south-1
- Credentials in **`.env`**, never `.env.local` (D-11)
- The direct DB host is IPv6-only and unreachable from this network; all tooling uses the
  IPv4 **session-mode pooler** via `scripts/db-url.mjs` — see RUNBOOK §2
- Demo tenant slug is `unversity-mess`, display name `unversity_mess` (D-13)

### Commands that must stay green

```bash
npm run verify        # typecheck + lint + tests
npm run db:verify     # schema assertions + a real JWT claim check against the live DB
npm run verify:phase1 # drives the whole service loop against the live DB (14 checks)
npm run verify:bearer # /api/* reachable, authenticated and gated over a bearer token
```

`verify:bearer` needs a running server and defaults to `http://localhost:3000`; point it
elsewhere with `PROBE_BASE_URL`. It creates and destroys its own `bearerprobe-…` tenant, so
it never touches Campus Crave or the demo hostel.

### Already learned the hard way — do not rediscover

- **A GRANT does not bypass RLS.** This silently broke the JWT hook (D-12).
- **The JWT claim is `user_role`, not `role`.** Supabase uses `role` for the Postgres role;
  overwriting it breaks PostgREST entirely.
- **Applied migrations are immutable** — `scripts/check-migrations.mjs` enforces it in
  pre-commit. Write a new migration; never edit 001–003.
- **`.env.local` must not exist** — Next.js prefers it over `.env`, which would point the
  app at a different database than the migrations.
- Money is integer paise. Dates derive in the tenant's timezone via `src/core/time`, never
  `toISOString().slice(0, 10)`.
- **Every rendered time names its timezone.** `Intl.DateTimeFormat` and `toLocaleString`
  silently fall back to the _device's_ zone, which is the server's on the back end and the
  student's phone on the front. `tests/unit/timezone-discipline.test.ts` scans the source and
  fails the build if a call site omits `timeZone`. For a plain calendar date with no instant
  behind it, build with `Date.UTC(...)` and read back with `timeZone: "UTC"` — that shifts
  nothing.
- **A QR token's service date is the date of its _meal_, not of the moment it was minted.**
  `issueToken` takes `serviceDate` as a required input for this reason; see the
  midnight-crossing dinner case in `tests/unit/qr-service-date.test.ts`.
- **A plan may only include meals the mess actually serves**, and a meal an active plan
  offers cannot be dropped from Settings. Without the first rule a plan promises a meal with
  no window — the student is refused at a counter that never opens — and the per-meal rate
  divides by meals that can never be claimed, understating it by half and corrupting every
  mess-cut credit built on it. The second rule keys on **active plans only**, never on
  subscription snapshots: snapshots are frozen history and can never be edited, so keying on
  them deadlocks the settings screen permanently.
- **Every nav link must resolve.** `src/lib/navigation.ts` is data, so a route can be listed
  long before it exists and nothing fails at build time — it 404s in the user's face
  instead. Phase-2 routes carry `disabled: true` and render as greyed spans; anything else
  needs a real page. Diff the nav hrefs against `find src/app -name page.tsx` after adding
  either. Feature-gated links (Absences) are built by `studentNav()` from flags the layout
  reads — the default is **hidden**, so a caller that forgets to pass settings advertises
  nothing.
- **`ON CONFLICT` cannot infer a PARTIAL unique index** — Postgres raises 42P10. Both
  `attendance_one_live_per_student_meal` and `mess_cuts_one_live_request_idx` are partial, so
  their writers do a plain INSERT and catch 23505. The idempotency guarantee is the index
  either way; only the error handling moves up a level.
- **The generated types carry no `Relationships`**, so every PostgREST embed arrives as
  `never` and must be named at the call site. Always unwrap with `firstRelated<T>()`: the
  embed is an **object** for a to-one relation and an **array** for to-many, and reading that
  wrong once already left every student session without a `studentId` in production.
- **`proxy.ts`'s `matcher` must be an inline literal.** Next statically analyses it at build
  time and, in its own words, "dynamic values such as variables will be ignored" — with no
  warning. Hoisting the pattern into a shared constant for testability left the proxy running
  on every path while a unit suite testing that constant went green; `/api/*` kept answering
  bearer requests with a 307 to the HTML login page. Assert against the real `config` export
  (`tests/unit/proxy-matcher.test.ts`) and confirm with a request to a running server —
  `npm run verify:bearer`. A passing unit test is not evidence here.

### Unresolved, and who owns it

- **Free tier has no PITR.** Acceptable for the pilot; upgrade before real student data
  matters.
- **Vercel Hobby allows only daily cron jobs**, with ±59 minutes of slack. A more frequent
  expression fails at deploy time. The headcount lock therefore runs once per meal per day,
  and the screens compute live projections in between — see RUNBOOK. Revisit if the pilot
  ever needs sub-daily scheduled work.

---

## Phase 0 — Foundations

**Exit criteria:** three roles can log in and land on their own shell; a cross-tenant query
provably returns nothing.

| #   | Task                                                                   | Status                |
| --- | ---------------------------------------------------------------------- | --------------------- |
| 0.1 | Next.js 16 + TS strict + Tailwind 4 scaffold                           | ✅                    |
| 0.2 | ESLint import boundaries, Prettier, Husky, Vitest, CI, migration guard | ✅                    |
| 0.3 | CLAUDE.md, this tracker, decision log, runbook                         | ✅                    |
| 0.4 | Migration 001 — tenancy, identity, RLS, JWT hook                       | ✅ applied + verified |
| 0.5 | Core layer — Result, errors, enums, money, tenant-timezone + tests     | ✅                    |
| 0.6 | Auth — roll-number login, `proxy.ts` gating, forced password change    | ✅                    |
| 0.7 | Seed two tenants; prove cross-tenant isolation                         | ✅                    |

### ✅ Phase 0 is complete — both exit criteria proven

`npm run db:verify` runs all three verification scripts and passes 43 checks:

1. **Three roles log in and land on their own shell.** admin / staff / student all
   authenticate and carry the correct `user_role` claim; the student signs in by
   **roll number**, not email (D-02).
2. **A cross-tenant query provably returns nothing.** Tested with a legitimately
   obtained, valid JWT — not by reading policy definitions. Both seeded tenants
   contain a student with roll number `CS21B001`, so any leak surfaces immediately.
   Tenant A sees its 8 students and only its own tenant row; a student sees only
   themselves, cannot read `tenant_secrets` or `audit_log`; and a cross-tenant
   insert is refused with HTTP 400.

## Phase 1 — Core Operating Loop

**Exit criteria:** the pilot hostel can run real lunch and dinner service, verified by QR,
with a correct headcount. Billing still on paper.

| #    | Task                                                               | Status                |
| ---- | ------------------------------------------------------------------ | --------------------- |
| 1.1  | Migration 002 — operations tables, RLS, realtime                   | ✅ applied + verified |
| 1.2  | Admin students list + add, credential issuance                     | ✅                    |
| 1.2d | Student detail — edit, status change, password reset, audited      | ✅                    |
| 1.3  | Plans & subscriptions, manual activation, price/meal-slot snapshot | ✅                    |
| 1.4  | Menu management + student menu view                                | ✅                    |
| 1.5a | QR token policy (pure) + `TokenSigner` port + tests                | ✅                    |
| 1.5b | Token issuance endpoint + rotating student QR screen               | ✅                    |
| 1.6a | `verifyQrAttendance` / `verifyManualAttendance` + fakes + tests    | ✅                    |
| 1.6b | Staff scanner UI, verify endpoint, error states, offline queue     | ✅                    |
| 1.7a | Headcount projection + variance policy (pure) + tests              | ✅                    |
| 1.7b | Live realtime count + snapshot cron job                            | ✅                    |
| 1.8  | E2E smoke tests, exit-criteria verification                        | ✅                    |

### Database state

Migrations 001–005 are applied to `yenxlcrtlmnfotfqqabo` and sealed immutable.

`npm run db:verify` asserts 13 tables with RLS, 10 enums, all uniqueness constraints, the
security helpers, realtime on `attendance`, constraint behaviour, **and** that a real
sign-in issues a JWT carrying `tenant_id` and `user_role`. All passing.

Migration 003 fixed a silent auth-hook failure — see D-12.

### What exists in `src/`

```
src/core/                            ✅ complete, pure, tested
  domain/{enums,identity,tenant-context}.ts
  policies/{qr,headcount}.policy.ts
  services/verify-attendance.ts
  ports/{repositories,token-signer}.ts
  time/index.ts                      tenant-timezone module
  money.ts  result.ts  errors/
src/infra/                           ✅ env, supabase clients + 7 repositories,
                                        hmac-signer, auth/session
src/components/                      ✅ app-shell, data-table (four states),
                                        page-header, stat-card, status-badge, ui/
src/app/(auth)/                      ✅ login, change-password
src/app/(app)/admin/                 ✅ dashboard, students list, students/new
src/app/(app)/{staff,student}/       ✅ shells + dashboards
src/proxy.ts                         ✅ session refresh + role gating
```

`(auth)` and `(app)` are **route groups** — parentheses keep them out of the URL, so
`(app)/admin/students/page.tsx` serves `/admin/students`. They exist so the signed-out
screens and the signed-in shell can have different layouts.

### Scripts

| Script                 | Purpose                                                           |
| ---------------------- | ----------------------------------------------------------------- |
| `check-migrations.mjs` | Pre-commit: applied migrations are immutable                      |
| `seal-migrations.mjs`  | Mark pushed migrations immutable (`npm run db:seal`)              |
| `db-url.mjs`           | Builds the pooler connection string; percent-encodes the password |
| `load-env.mjs`         | Loads `.env`; warns if a `.env.local` appears                     |
| `gen-types.mjs`        | Generates DB types by catalog introspection (no Docker, no PAT)   |
| `verify-schema.mjs`    | Asserts RLS, constraints, enums, policies                         |
| `verify-jwt-hook.mjs`  | Signs in for real and decodes the token's claims                  |

### ✅ Phase 1 is complete — exit criteria proven

**"The pilot hostel can run real lunch and dinner service, verified by QR, with a correct
headcount."**

`npm run verify:phase1` drives the same services the HTTP routes call, against the **live**
database, and passes 14 checks. It creates its own throwaway student so no seeded or real
row is touched, and cleans up afterwards.

1. **QR issuance** — an eligible student gets a signed token; the wrong secret, an expired
   token, and a token scanned outside its meal window are each rejected. The screen's
   refresh interval is verified to be shorter than the token TTL.
2. **Blocked students** — denied at issuance _and_ at the counter. The manual fallback
   refuses them too, proving it is not a bypass.
3. **Idempotency** — a second scan of the same meal returns `ALREADY_SERVED`; three
   simultaneous scans produce exactly one success and exactly one row per meal.
4. **Audit** — every manual override is written with its reason.
5. **Headcount** — a snapshot per served meal; re-running the cron does not duplicate rows;
   a locked count never moves even when the underlying subscriptions change.
6. **Multi-tenancy** — another mess cannot serve this student by roll number.

## Mobile app (Flutter) — student + staff 🚧

One Flutter binary for both roles, routed by the role the server returns at login. Admin
stays on the Next.js web console — it is 13,219 lines across 63 files (72% of the app's UI),
built on dense desktop tables that Flutter Web is worst at. The Next project remains the
backend regardless: it hosts `src/core`, the API routes, service-role access and the crons.

**No domain policy is reimplemented in Dart.** The mobile client calls the same
`src/core` services through JSON endpoints; only formatting, the status-colour vocabulary and
the denial-code presentation map cross over.

### ✅ Slice 0 — bearer transport (2026-09-09)

Three defects made the backend unreachable from any non-browser client. All fixed and
**verified against a running server**, not just unit-tested:

1. **`/api/*` was redirected, not served.** `proxy.ts`'s matcher covered `/api`, so a
   bearer request with no cookie got a 307 to the HTML login page and never reached the
   handler. See the matcher entry under "learned the hard way" — the first fix silently
   did nothing.
2. **No bearer client.** `src/infra/supabase/bearer.ts` — anon key, no cookie adapter,
   `Authorization` header. RLS applies identically; it is not privileged.
3. **`must_change_password` was unenforced on the API.** It lived only in
   `src/app/(app)/layout.tsx`, which `/api/*` sits outside of — so the app would have been a
   permanent way around the forced change, on passwords derived from the student's own
   mobile number and known to whoever created the account.

`getSessionUser()` keeps its signature; `getSessionUserFromToken()` returns the **identical
`SessionUser`**, so all 115 call sites are transport-agnostic. The shared guard
`authenticateApiRequest()` (`src/infra/http/api-auth.ts`) returns the user **and the
correctly-scoped Supabase client together** — handing them back separately is how a route
ends up authenticating one way and querying another, which would have failed every mobile
request under RLS.

Applied to `/api/qr/token`, `/api/qr/verify`, and both photo routes.

**Proven by `npm run verify:bearer`** (4/4): unauthenticated → 401 JSON not a redirect; a
real student's token reaches the handler and gets `NO_ACTIVE_PLAN`; a garbage token → 401
(fails closed); a student owing a password change → 403 `PASSWORD_CHANGE_REQUIRED`.

### Next: Slice 1 — login and role routing

`POST /api/auth/login` must resolve a **mobile number** to the synthetic roll-number address
(`cs21b001@campus-crave.mess.invalid`) server-side — that lookup needs the service-role key
and can never ship in a Flutter binary. Reuses `classifyLoginIdentifier` and
`rateLimitBuckets.login` (10 / 5 min per identifier). Then `/api/auth/change-password`,
`/api/auth/logout`, `GET /api/me`, and the Flutter foundation + design-system port.

Full plan: `~/.claude-profiles/personal/plans/quiet-sparking-stardust.md`.

## Phase 2 — Money ⏸️ _out of MVP scope_

Ledger · invoices · Razorpay orders + webhooks + idempotency · manual payment override ·
mess-cut request flow with advance-notice and monthly-cap enforcement · credit computation ·
grace → block state machine + QR gating · student billing history · admin finance dashboard.

Blocked on: open decisions D-05 and D-06 in [DECISIONS.md](DECISIONS.md).

## Phase 3 — Experience & Insight ⏸️

Guest tokens & extra plates · feedback with rating trends · admin reports (collections,
variance, cut patterns) · PWA polish, offline shell, push · scanner UX hardening.

## Phase 4 — Productization ⏸️

Platform super-admin console · self-serve tenant onboarding · SaaS subscription billing ·
per-tenant branding · usage metering · data export/deletion · support runbook.

---

## Test debt register

Cases from architecture doc §10 that must exist before the relevant phase ships.

| Case                                                               | Phase | Status |
| ------------------------------------------------------------------ | ----- | ------ |
| Same QR scanned twice → `ALREADY_SERVED`, no second attendance row | 1     | ✅     |
| Blocked student → denied at verification (`BLOCKED_UNPAID`)        | 1     | ✅     |
| Scanning outside the tenant meal window → rejected                 | 1     | ✅     |
| Forged / tampered QR signature → rejected                          | 1     | ✅     |
| Expired token (past TTL) → rejected                                | 1     | ✅     |
| Cross-tenant token → rejected (wrong-secret and wrong-tenant)      | 1     | ✅     |
| Service date derived at a tenant-local day boundary → correct day  | 0     | ✅     |
| Manual fallback runs the same checks — not a bypass                | 1     | ✅     |
| Attendance write failure → fails closed, records nothing           | 1     | ✅     |
| Month-boundary range splitting (28 Mar–2 Apr → 4 + 2)              | 0     | ✅     |
| Credits can never exceed the amount paid (per-meal remainder)      | 0     | ✅     |
| Cross-tenant read with a valid JWT → sees only own tenant          | 0     | ✅     |
| Blocked student's **token issuance** → denied                      | 1     | ✅     |
| HMAC signer uses constant-time comparison                          | 1     | ✅     |
| Two concurrent scans of one student → exactly one attendance row   | 1     | ✅     |
| Duplicate Razorpay webhook → exactly one ledger entry              | 2     | ⏸️     |
| Mess cut spanning a month boundary → correct per-month accounting  | 2     | ⏸️     |
| Cut requested at 11h59m before the meal → rejected                 | 2     | ⏸️     |
| Credits exceeding invoice total → floors at zero, surplus carries  | 2     | ⏸️     |
