# Implementation Tracker

Source of truth for _what is built_ and _what is next_. Update the status column in the
same commit as the work. Phases follow architecture doc §11.

**MVP = Phase 0 + Phase 1.** Phases 2–4 are scoped but deliberately not started.

Legend: ✅ done · 🚧 in progress · ⬜ not started · ⏸️ deferred by decision

---

## ▶ RESUME HERE — state as of 2026-07-25

**Read this first if you are picking the project up cold.** It is written to survive a lost
conversation: everything needed to continue correctly is here or linked from here.

### What is done and verified

| Area                                  | State                                                               |
| ------------------------------------- | ------------------------------------------------------------------- |
| Repo, tooling, CI, import boundaries  | ✅ `npm run verify` green                                           |
| Core domain (pure, no I/O)            | ✅ **415 tests**, 99%+ coverage                                     |
| Database schema                       | ✅ migrations 001–005 **applied + sealed** on the live project      |
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

**Phase 0 is done.** Three roles sign in against the live database and land on their own
shell; cross-tenant isolation is proven with real data. Phase 1 domain logic (QR policy,
attendance verification, headcount projection) is already written and tested — what
remains is the screens and endpoints on top of it.

### Demo logins (after `npm run db:seed`)

| Role    | Identifier                          | Password      |
| ------- | ----------------------------------- | ------------- |
| Admin   | `admin@unversity-mess.test`         | `MessOS@2026` |
| Staff   | `staff@unversity-mess.test`         | `MessOS@2026` |
| Student | `CS21B003` (roll number, not email) | `MessOS@2026` |

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

1. **The deferred cleanup list** below — the repo is still public, and there is a general
   tidy-up pass outstanding.
2. **Widen the pilot's meal windows temporarily** if the client wants to test outside
   12:00–14:30 / 19:30–22:00 IST. Scans are correctly refused outside them.
3. **Phase 2 (money)** is blocked on D-05 and D-06, which need the product owner.

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
```

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
  either.

### Unresolved, and who owns it

- **D-05 / D-06** (mess-cut cap shape, partial-day cuts) — awaiting product owner. Blocks
  Phase 2 only; the schema already supports both answers.
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
