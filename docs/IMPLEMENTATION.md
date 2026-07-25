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

| Area                                 | State                                                          |
| ------------------------------------ | -------------------------------------------------------------- |
| Repo, tooling, CI, import boundaries | ✅ `npm run verify` is green                                   |
| Core domain (pure, no I/O)           | ✅ complete, **159 tests**, 99%+ coverage                      |
| Database schema                      | ✅ migrations 001–003 **applied + sealed** on the live project |
| JWT auth hook                        | ✅ enabled in dashboard **and** verified end-to-end            |
| Generated DB types                   | ✅ `src/infra/supabase/database.types.ts`                      |
| Infrastructure layer (`src/infra`)   | ⬜ **does not exist yet**                                      |
| Any UI, auth, or routes              | ⬜ **does not exist yet**                                      |

The domain is finished and the database is real. **Nothing is wired between them.**
`src/app` is still the untouched `create-next-app` default page.

### Next steps, in order

1. **`src/lib/env.ts`** — Zod-validated env. Server-only vars must never be reachable from
   a client component. Parse, don't trust (rule 10).
2. **Supabase clients** — `src/lib/supabase/{client,server,admin}.ts` using
   `@supabase/ssr`. Use the `getAll`/`setAll` cookie methods (the `get`/`set`/`remove` form
   is deprecated); in this version `setAll` receives `(cookiesToSet, headers)`. Prefer
   `getClaims()` over `getSession()` — it verifies the JWT and returns our custom
   `tenant_id` / `user_role` claims without a network round trip.
3. **`src/infra/crypto/hmac-signer.ts`** — implements the `TokenSigner` port with
   `node:crypto`. **Must use `crypto.timingSafeEqual`**; a byte-wise comparison leaks the
   signature. Add a test that it round-trips with `qr.policy` and rejects tampering.
4. **`src/infra/supabase/repositories/*`** — implement the ports already defined in
   `src/core/ports/repositories.ts`. `AttendanceRepository.record` **must** use
   `INSERT … ON CONFLICT DO NOTHING RETURNING` and report `created: false` on conflict —
   never read-then-write, which breaks when two counters scan at once.
5. **Auth (Phase 0.6)** — roll-number login per D-02, `src/proxy.ts` route gating (Next 16
   renamed `middleware.ts`; nodejs runtime only), forced password change, three role shells.
6. **Seed (Phase 0.7)** — demo tenant + admin + staff + students + plans + menu. Seed
   **two** tenants so cross-tenant isolation is provable against real data.
7. Then Phase 1.2 → 1.8 in the table below.

### Live project facts

- Supabase project `yenxlcrtlmnfotfqqabo` — name `unversity_mess`, **free tier**, ap-south-1
- Credentials in **`.env`**, never `.env.local` (D-11)
- The direct DB host is IPv6-only and unreachable from this network; all tooling uses the
  IPv4 **session-mode pooler** via `scripts/db-url.mjs` — see RUNBOOK §2
- Demo tenant slug is `unversity-mess`, display name `unversity_mess` (D-13)

### Commands that must stay green

```bash
npm run verify      # typecheck + lint + tests
npm run db:verify   # schema assertions + a real JWT claim check against the live DB
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

### Unresolved, and who owns it

- **D-05 / D-06** (mess-cut cap shape, partial-day cuts) — awaiting product owner. Blocks
  Phase 2 only; the schema already supports both answers.
- **Free tier has no PITR.** Acceptable for the pilot; upgrade before real student data
  matters.

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
| 0.6 | Auth — roll-number login, `proxy.ts` gating, forced password change    | ⬜                    |
| 0.7 | Seed demo tenant; prove cross-tenant isolation                         | 🚧 half               |

**Exit criterion "cross-tenant query returns nothing" is already proven** by
`scripts/verify-jwt-hook.mjs` — a real signed-in user sees exactly their own tenant row.
The "three roles log in" half needs 0.6.

## Phase 1 — Core Operating Loop

**Exit criteria:** the pilot hostel can run real lunch and dinner service, verified by QR,
with a correct headcount. Billing still on paper.

| #    | Task                                                               | Status                |
| ---- | ------------------------------------------------------------------ | --------------------- |
| 1.1  | Migration 002 — operations tables, RLS, realtime                   | ✅ applied + verified |
| 1.2  | Admin student CRUD + credential issuance                           | ⬜                    |
| 1.3  | Plans & subscriptions, manual activation, price/meal-slot snapshot | ⬜                    |
| 1.4  | Menu management + student menu view                                | ⬜                    |
| 1.5a | QR token policy (pure) + `TokenSigner` port + tests                | ✅                    |
| 1.5b | Token issuance endpoint + rotating student QR screen               | ⬜                    |
| 1.6a | `verifyQrAttendance` / `verifyManualAttendance` + fakes + tests    | ✅                    |
| 1.6b | Staff scanner UI, verify endpoint, error states, offline queue     | ⬜                    |
| 1.7a | Headcount projection + variance policy (pure) + tests              | ✅                    |
| 1.7b | Live realtime count + snapshot cron job                            | ⬜                    |
| 1.8  | E2E smoke tests, exit-criteria verification                        | ⬜                    |

### Database state

Migrations 001–003 are applied to `yenxlcrtlmnfotfqqabo` and sealed immutable.

`npm run db:verify` asserts 13 tables with RLS, 10 enums, all uniqueness constraints, the
security helpers, realtime on `attendance`, constraint behaviour, **and** that a real
sign-in issues a JWT carrying `tenant_id` and `user_role`. All passing.

Migration 003 fixed a silent auth-hook failure — see D-12.

### What exists in `src/`

```
src/core/                            ✅ complete, pure, tested
  domain/{enums,tenant-context}.ts
  policies/{qr,headcount}.policy.ts
  services/verify-attendance.ts
  ports/{repositories,token-signer}.ts
  time/index.ts                      tenant-timezone module
  money.ts  result.ts  errors/
src/infra/supabase/database.types.ts   ✅ generated from the live schema
src/app/                             ⬜ still create-next-app default
src/infra/                           ⬜ does not exist
```

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
| Blocked student's **token issuance** → denied                      | 1     | ⬜     |
| HMAC signer uses constant-time comparison                          | 1     | ⬜     |
| Two concurrent scans of one student → exactly one attendance row   | 1     | ⬜     |
| Duplicate Razorpay webhook → exactly one ledger entry              | 2     | ⏸️     |
| Mess cut spanning a month boundary → correct per-month accounting  | 2     | ⏸️     |
| Cut requested at 11h59m before the meal → rejected                 | 2     | ⏸️     |
| Credits exceeding invoice total → floors at zero, surplus carries  | 2     | ⏸️     |
