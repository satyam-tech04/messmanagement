# Mess Management System — Architecture & Implementation Plan

**Version:** 1.0
**Stack:** Next.js (App Router) · TypeScript · Tailwind + shadcn/ui · Supabase (Postgres, Auth, RLS, Realtime, Edge Functions, pg_cron) · Razorpay · Vercel
**Delivery model:** PWA-first, single codebase, three role-based surfaces, multi-tenant from day one

---

## 1. Product Summary

A multi-tenant SaaS for hostel mess operations. Students hold a fixed-price subscription (monthly or quarterly) covering **lunch and dinner**. Attendance is verified at the counter by scanning a **rotating, server-validated QR code**. Missed meals earn credit only when paused **≥12 hours in advance**, capped per month. Payments run through Razorpay with a manual offline override. Unpaid accounts are blocked from generating QR codes after a **3-day grace period**.

### 1.1 Locked Business Rules (v1)

| Rule                    | Value                                    | Configurable per tenant? |
| ----------------------- | ---------------------------------------- | ------------------------ |
| Meal slots              | Lunch, Dinner                            | Yes                      |
| Plan durations          | Monthly, Quarterly                       | Yes                      |
| Mess-cut advance notice | ≥ 12 hours before meal                   | Yes                      |
| Mess-cut monthly cap    | 5 days / calendar month                  | Yes                      |
| Payment grace period    | 3 days past due date                     | Yes                      |
| Post-grace action       | Block QR generation                      | Yes                      |
| Credit destination      | Applied to next invoice (not refunded)   | No (v1)                  |
| Feedback                | 1–5 stars + optional comment             | No                       |
| Extras                  | Guest tokens & extra plates, pay-per-use | Yes                      |

> **Every number in this table is a row in `tenant_settings`, never a constant in code.** You are building a product, not one hostel's software. The moment a rule is hardcoded, the second customer becomes a fork.

### 1.2 Actors

| Actor                    | Surface               | Core capability                                  |
| ------------------------ | --------------------- | ------------------------------------------------ |
| **Student**              | Mobile PWA            | Show QR, pause plan, pay, buy extras, rate meals |
| **Counter Staff**        | Tablet/phone PWA      | Scan QR, verify identity, see live bulk count    |
| **Master Admin**         | Desktop web           | Menu, plans, students, finance, reports          |
| **Platform Super Admin** | Desktop web (Phase 4) | Tenant provisioning, SaaS subscription, support  |

---

## 2. Guiding Design Principles

These are not decoration. Each maps to a specific failure this system is prone to.

### 2.1 Domain logic lives in pure TypeScript, never in components or SQL

Billing math, mess-cut eligibility, QR validation rules, and headcount projection are **pure functions in `/src/core`** with zero imports from React, Next.js, or Supabase. They take data in and return decisions out.

**Why this matters here specifically:** your billing rules will change per customer and per negotiation. If "is this cut eligible?" is spread across a React form, a Postgres trigger, and an Edge Function, changing the cap from 5 to 7 days becomes a three-place archaeology dig with no test coverage. Pure functions make it one file and one test.

### 2.2 Dependency inversion — core defines interfaces, infrastructure implements them

`/src/core` declares `interface SubscriptionRepository`. `/src/infra/supabase` implements it. Core never imports Supabase.

**Payoff:** you can unit-test the entire billing engine with in-memory fakes, no database, in milliseconds. And when you eventually add RFID (you will, for large messes), the attendance verification service doesn't change — only the adapter behind `AttendanceVerifier` does.

Enforce mechanically with ESLint `import/no-restricted-paths`:

```
/src/core     → may import: nothing outside /src/core
/src/infra    → may import: /src/core
/src/app      → may import: /src/core, /src/infra, /src/components
```

If the rule isn't enforced by lint, it will be violated within two weeks.

### 2.3 Money is integer paise, always

Never `float`, never `numeric` handled as JS number, never rupees. Store `amount_paise BIGINT`. Format only at the render boundary. Every currency-splitting operation (per-meal rate from a plan price) must have an explicit remainder-handling strategy — the last meal absorbs the rounding remainder so credits never exceed the amount paid.

### 2.4 Financial records are immutable; balances are derived

Never `UPDATE students SET balance = ...`. Write an **append-only ledger**. Balance is `SUM(ledger_entries)`. Corrections are new reversing entries, not edits.

**Why:** a mess owner will call you saying "this student says he paid ₹4,000 in March." With a mutable balance column you have no answer. With a ledger you have the exact sequence with timestamps and actor IDs. This is non-negotiable for anything you intend to sell.

### 2.5 Every state-changing operation is idempotent

Retries, double-taps, duplicate webhooks, and flaky mess-counter Wi-Fi are guaranteed. Enforce with database constraints, not application checks:

- Attendance: `UNIQUE (tenant_id, student_id, service_date, meal_slot)`
- Payments: `UNIQUE (tenant_id, gateway_payment_id)`
- Invoices: `UNIQUE (subscription_id, period_start)`
- Mess-cut credits: `UNIQUE (mess_cut_id)` on the ledger entry

A retried Razorpay webhook must produce zero additional ledger entries. Test this explicitly.

### 2.6 Explicit state machines, not boolean soup

Avoid `is_active`, `is_blocked`, `is_paid`, `has_expired`. Use a single `status` enum per entity with documented legal transitions and a `canTransition()` guard in core. Boolean soup produces impossible states — a student who is simultaneously blocked and active — and nobody can tell which flag wins.

### 2.7 Fail closed on security and money

If QR validation cannot reach the database, deny the scan (staff use the audited manual fallback). If a webhook signature can't be verified, reject it. If a student's subscription status is indeterminate, treat as inactive. The cost of one wrongly-denied meal is a 20-second manual override; the cost of a systematically bypassable QR is your product's credibility.

### 2.8 Multi-tenancy is a data-model property, not a feature

`tenant_id` on **every** business table, on **every** index, in **every** query, enforced by RLS _and_ by the application layer. There is no "add multi-tenancy later" — retrofitting it means auditing every query you ever wrote.

### 2.9 Time is tenant-local

Store timestamps as `timestamptz` (UTC). Store `service_date` as a plain `date` computed in the **tenant's timezone**. The 12-hour cutoff, "today's menu," and daily headcount all depend on the hostel's local day boundary, not UTC's. Every date derivation goes through one `core/time` module. This single decision prevents the most common and most confusing class of bug in this system.

### 2.10 Validate at every boundary with Zod

Every API route input, every Edge Function payload, every webhook body, every env var. Parse, don't trust. Generate Supabase types (`supabase gen types typescript`) and commit them so the compiler catches schema drift.

---

## 3. System Architecture

### 3.1 Layered View

```
┌─────────────────────────────────────────────────────────┐
│  PRESENTATION  /src/app                                  │
│  Student PWA · Staff Scanner · Admin Console             │
│  Server Components + Server Actions + shadcn/ui          │
└───────────────────────┬─────────────────────────────────┘
                        │ calls use cases only
┌───────────────────────▼─────────────────────────────────┐
│  APPLICATION  /src/core/services                         │
│  ApplyMessCut · VerifyAttendance · GenerateInvoice        │
│  RecordPayment · ProjectHeadcount · PurchaseExtra         │
│  Orchestration, transactions, authorization              │
└───────────────────────┬─────────────────────────────────┘
                        │ uses
┌───────────────────────▼─────────────────────────────────┐
│  DOMAIN  /src/core/domain + /src/core/policies           │
│  Pure. No I/O. Entities, value objects, business rules.  │
│  BillingPolicy · MessCutPolicy · GracePolicy · QrPolicy  │
└───────────────────────┬─────────────────────────────────┘
                        │ interfaces implemented by
┌───────────────────────▼─────────────────────────────────┐
│  INFRASTRUCTURE  /src/infra                              │
│  Supabase repos · Razorpay adapter · Push · Cron handlers│
└─────────────────────────────────────────────────────────┘
```

**The rule:** dependencies point inward only. Domain knows nothing about anything.

### 3.2 Repository Structure

```
mess-os/
├── src/
│   ├── app/
│   │   ├── (student)/            # role-gated route group
│   │   │   ├── qr/               # rotating QR display
│   │   │   ├── plan/             # subscription, pause, history
│   │   │   ├── menu/
│   │   │   ├── extras/
│   │   │   ├── billing/
│   │   │   └── feedback/
│   │   ├── (staff)/
│   │   │   ├── scan/             # primary scanner screen
│   │   │   ├── manual/           # audited fallback lookup
│   │   │   └── counts/           # live bulk count
│   │   ├── (admin)/
│   │   │   ├── dashboard/
│   │   │   ├── students/
│   │   │   ├── plans/
│   │   │   ├── menu/
│   │   │   ├── finance/
│   │   │   ├── reports/
│   │   │   └── settings/
│   │   └── api/
│   │       ├── qr/token/         # issue rotating token
│   │       ├── qr/verify/        # validate scan
│   │       ├── webhooks/razorpay/
│   │       └── cron/             # invoked by scheduler
│   │
│   ├── core/                     # ⛔ NO framework imports
│   │   ├── domain/               # entities, value objects, enums
│   │   ├── policies/             # pure business rules
│   │   │   ├── billing.policy.ts
│   │   │   ├── mess-cut.policy.ts
│   │   │   ├── grace.policy.ts
│   │   │   ├── qr.policy.ts
│   │   │   └── headcount.policy.ts
│   │   ├── services/             # use cases
│   │   ├── ports/                # repository interfaces
│   │   ├── errors/               # typed domain errors
│   │   └── time/                 # tenant-timezone helpers
│   │
│   ├── infra/
│   │   ├── supabase/repositories/
│   │   ├── razorpay/
│   │   ├── notifications/
│   │   └── crypto/               # HMAC token signing
│   │
│   ├── components/ui/            # shadcn
│   └── lib/                      # config, zod schemas, utils
│
├── supabase/
│   ├── migrations/               # sequential, never edited once applied
│   ├── functions/                # edge functions
│   └── seed.sql
│
└── tests/
    ├── unit/                     # policies — fast, no I/O
    ├── integration/              # against local Supabase
    └── e2e/                      # Playwright
```

---

## 4. Data Model

All tables carry `tenant_id UUID NOT NULL REFERENCES tenants(id)` and `created_at timestamptz DEFAULT now()`. All money columns are `BIGINT` paise.

### 4.1 Tenancy & Identity

**`tenants`** — `id, name, type (HOSTEL|CLOUD_KITCHEN|BULK_SUPPLY), timezone, status, created_at`

**`tenant_settings`** — one row per tenant. The policy store.
`tenant_id (PK), meal_slots jsonb, cut_advance_hours (12), cut_max_days_per_month (5), grace_period_days (3), block_on_overdue bool, currency, allow_extras bool, guest_token_price_paise, extra_plate_price_paise`

**`profiles`** — extends `auth.users`. `id (=auth.uid), tenant_id, role (STUDENT|STAFF|ADMIN|SUPER_ADMIN), full_name, phone, photo_url, status`

**`students`** — `id, tenant_id, profile_id, roll_number, block, room_number, joined_at, status (ACTIVE|GRACE|BLOCKED|INACTIVE)`
`UNIQUE (tenant_id, roll_number)`

### 4.2 Plans & Subscriptions

**`plans`** — `id, tenant_id, name, duration_type (MONTHLY|QUARTERLY), duration_days, price_paise, included_meal_slots text[], is_active`

**`subscriptions`** — `id, tenant_id, student_id, plan_id, price_paise_snapshot, included_meal_slots_snapshot, start_date, end_date, status, auto_renew`

> **Snapshot the price and included meals onto the subscription.** When the admin raises the plan price next quarter, existing subscribers must not have their historical invoices silently recalculated. Never compute past money from present configuration.

State machine: `PENDING_PAYMENT → ACTIVE → (EXPIRED | CANCELLED)`

### 4.3 Ledger & Payments

**`invoices`** — `id, tenant_id, student_id, subscription_id, period_start, period_end, subtotal_paise, credits_applied_paise, total_paise, due_date, status (DRAFT|ISSUED|PARTIALLY_PAID|PAID|OVERDUE|VOID)`
`UNIQUE (subscription_id, period_start)`

**`ledger_entries`** — **append-only, never updated or deleted.**
`id, tenant_id, student_id, entry_type, direction (DEBIT|CREDIT), amount_paise, ref_type, ref_id, description, created_by, created_at`

Entry types: `SUBSCRIPTION_CHARGE`, `PAYMENT_RECEIVED`, `MESS_CUT_CREDIT`, `EXTRA_PLATE_CHARGE`, `GUEST_TOKEN_CHARGE`, `MANUAL_ADJUSTMENT`, `REVERSAL`

**`payments`** — `id, tenant_id, student_id, invoice_id, amount_paise, method (UPI|CARD|NETBANKING|CASH|BANK_TRANSFER), source (GATEWAY|MANUAL), gateway_order_id, gateway_payment_id, gateway_signature, status, recorded_by, notes`
`UNIQUE (tenant_id, gateway_payment_id) WHERE gateway_payment_id IS NOT NULL`

### 4.4 Operations

**`mess_cuts`** — `id, tenant_id, student_id, subscription_id, date_from, date_to, meal_slots text[], requested_at, effective_from timestamptz, status (APPROVED|REJECTED|CANCELLED|CREDITED), meals_credited int, credit_amount_paise, rejection_reason`

**`menus`** — `id, tenant_id, service_date, meal_slot, items jsonb, notes, published_by`
`UNIQUE (tenant_id, service_date, meal_slot)`

**`attendance`** — `id, tenant_id, student_id, service_date, meal_slot, scanned_at, method (QR|MANUAL|RFID), verified_by, device_id, override_reason`
`UNIQUE (tenant_id, student_id, service_date, meal_slot)` ← the anti-double-serving and anti-replay guarantee

**`extra_purchases`** — `id, tenant_id, student_id, type (GUEST_TOKEN|EXTRA_PLATE), quantity, unit_price_paise, total_paise, service_date, meal_slot, status (PAID|REDEEMED|EXPIRED|REFUNDED), redemption_code, redeemed_at, redeemed_by`

**`headcount_snapshots`** — the kitchen's locked number.
`id, tenant_id, service_date, meal_slot, projected_count, guest_count, extra_plate_count, locked_at`
`UNIQUE (tenant_id, service_date, meal_slot)`

**`feedback`** — `id, tenant_id, student_id, service_date, meal_slot, rating (1-5), comment, created_at`
`UNIQUE (tenant_id, student_id, service_date, meal_slot)`

**`audit_log`** — `id, tenant_id, actor_profile_id, action, entity_type, entity_id, before jsonb, after jsonb, ip, created_at`

Write to it for: manual payment entry, manual attendance override, plan price change, student block/unblock, settings change, ledger adjustment. These are exactly the actions that become disputes.

### 4.5 Indexing

```sql
CREATE INDEX ON attendance (tenant_id, service_date, meal_slot);
CREATE INDEX ON ledger_entries (tenant_id, student_id, created_at DESC);
CREATE INDEX ON mess_cuts (tenant_id, student_id, date_from, date_to);
CREATE INDEX ON invoices (tenant_id, status, due_date);
CREATE INDEX ON subscriptions (tenant_id, status, end_date);
```

Every index leads with `tenant_id` — it is the highest-selectivity column in a multi-tenant system.

---

## 5. Multi-Tenant Security Model

### 5.1 Two independent layers

1. **Application layer (primary):** every use case receives an explicit `TenantContext { tenantId, actorId, role }` derived server-side from the session. Never from a client-supplied parameter.
2. **RLS (defence in depth):** Postgres policies reject cross-tenant rows even if application code is wrong.

Treating RLS as the _only_ authorization is a common mistake — it protects rows but cannot express "staff may verify attendance but not issue refunds." Do both.

### 5.2 Custom JWT claims

Use a Supabase Auth Hook to inject `tenant_id` and `role` into the JWT on login. RLS policies then read them without an extra lookup per query:

```sql
CREATE POLICY tenant_isolation ON attendance
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
```

Layer role-specific policies on top of tenant isolation for each table.

### 5.3 Key handling

- `SUPABASE_SERVICE_ROLE_KEY` — server-side only. Never in a client component, never in `NEXT_PUBLIC_*`. It bypasses RLS entirely.
- QR signing secret — per-tenant, stored server-side, rotatable.
- Razorpay secret — server-side only; webhook signature verified on every call.

---

## 6. The QR Attendance System

The most security-sensitive and operationally-critical component.

### 6.1 Threat model

| Threat                                  | Mitigation                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Student screenshots QR, sends to friend | Token TTL of 30s, client refreshes every 15s                                                            |
| Student replays their own token         | `UNIQUE (tenant_id, student_id, service_date, meal_slot)` — second scan is rejected as `ALREADY_SERVED` |
| Forged token                            | HMAC-SHA256 signed server-side with a per-tenant secret                                                 |
| Blocked student eats anyway             | Token issuance checks account status; verification re-checks                                            |
| Scanning outside meal hours             | Verification checks tenant meal window                                                                  |
| Staff fabricating attendance            | Manual overrides require a reason, are audit-logged, and surface on the admin dashboard                 |

### 6.2 Token design — stateless HMAC, not database rows

A 300-student mess refreshing tokens every 15 seconds would generate ~72,000 DB writes per hour if tokens were persisted. Instead:

```
payload = base64url({ v:1, t:tenantId, s:studentId, m:mealSlot, d:serviceDate, iat, nonce })
token   = payload + "." + HMAC_SHA256(payload, tenantSecret)
```

Stateless, no write amplification, and replay within the TTL is already blocked by the attendance uniqueness constraint. That constraint is doing the real security work — the short TTL just narrows the window for social sharing.

### 6.3 Verification sequence

```
Student app          Staff scanner              Server
     │                     │                       │
     ├─ GET /api/qr/token ─────────────────────────►
     │◄──── signed token (TTL 30s) ─────────────────┤
     │  render + auto-refresh @15s                  │
     │                     │                       │
     │═══ camera scan ════►│                       │
     │                     ├─ POST /api/qr/verify ─►
     │                     │                       ├─ verify HMAC
     │                     │                       ├─ check TTL
     │                     │                       ├─ check tenant match
     │                     │                       ├─ check meal window (tenant TZ)
     │                     │                       ├─ check subscription ACTIVE
     │                     │                       ├─ check student not BLOCKED
     │                     │                       ├─ check no approved mess-cut
     │                     │                       ├─ INSERT attendance (unique)
     │                     │◄── {ok, name, photo} ──┤
     │                     │  green tick + name     │
```

**Staff must see the student's name and photo on success.** The QR proves possession of a phone, not identity. The human check at the counter closes that gap and costs nothing.

### 6.4 Failure and fallback — design this now, not after go-live

Mess counters have bad Wi-Fi during exactly the 20 minutes that matter. Build:

- **Manual lookup** by roll number → same validation path, `method='MANUAL'`, mandatory reason code, audit-logged, flagged on the admin dashboard.
- **Distinct error states on the scanner UI**, each with a different colour and sound: `ALREADY_SERVED`, `BLOCKED_UNPAID`, `NO_ACTIVE_PLAN`, `ON_MESS_CUT`, `OUTSIDE_MEAL_HOURS`, `EXPIRED_TOKEN`, `NETWORK_ERROR`. A generic red X forces staff to debug at the counter with a queue behind them.
- **Client-side queue** for `NETWORK_ERROR`: store the scan locally, retry on reconnect, mark `sync_pending`. Idempotency makes replay safe.

**Performance target:** p95 verification < 500 ms. At 200 students in 20 minutes you have ~6 seconds per student including walking.

---

## 7. Billing Engine

### 7.1 Per-meal rate derivation

```
totalMealsInPeriod = billingDaysInPeriod × includedMealSlots.length
perMealPaise       = floor(planPricePaise / totalMealsInPeriod)
```

Rounding remainder stays with the mess, never with the student — total credits can never exceed what was paid. Encode this as an explicit, tested invariant.

### 7.2 Mess-cut eligibility (pure function)

```ts
canApplyMessCut(input): Result<MessCutApproval, MessCutRejection>
```

Checks, in order:

1. Subscription is `ACTIVE` and the requested dates fall inside its term
2. `effective_from` ≥ `now + cut_advance_hours` (12h), computed in tenant timezone
3. Requested days + already-approved days in that calendar month ≤ `cut_max_days_per_month` (5)
4. No overlap with an existing approved cut
5. No attendance already recorded for those slots

**Month-boundary case:** a cut spanning 28 Mar – 2 Apr must count 4 days against March and 2 against April, evaluated independently. Write the test first — this is where implementations quietly break.

### 7.3 Credit application

On cut approval, compute `meals_credited × perMealPaise` and write a single `MESS_CUT_CREDIT` ledger entry keyed to `mess_cut_id` (unique). Credit is **applied to the next invoice**, never refunded to a bank account in v1. This keeps you out of refund reconciliation entirely.

Invoice generation: `total = subtotal − min(availableCredits, subtotal)`. Credits never make a total negative; the surplus carries forward.

### 7.4 Grace and blocking

```
invoice.due_date passes with balance > 0  → student.status = GRACE
GRACE + grace_period_days (3) elapsed     → student.status = BLOCKED
payment clears balance                    → student.status = ACTIVE (immediately)
```

Evaluated by a nightly cron **and** re-checked at QR issuance and at verification. Do not rely on cron alone — a student paying at 11 PM must eat lunch tomorrow without waiting for a job to run.

### 7.5 Razorpay integration

- **Order creation** server-side; amount always recomputed on the server from the invoice, never accepted from the client.
- **Webhook** at `/api/webhooks/razorpay` — verify `X-Razorpay-Signature` before parsing the body. Reject unsigned.
- **Idempotent processing** — `UNIQUE (tenant_id, gateway_payment_id)`. Duplicate deliveries produce zero extra ledger entries.
- **Webhook is the source of truth**, not the client success callback. The client callback only updates the UI optimistically.
- **Manual override** — admin marks paid with `source='MANUAL'`, `method='CASH'`, mandatory note, recorded actor, audit-logged.

For recurring monthly/quarterly renewals, start with **invoice + payment link per cycle** rather than Razorpay Subscriptions/e-mandate. It is materially simpler, and mess billing genuinely varies month to month once mess-cut credits apply. Revisit auto-debit in Phase 4.

---

## 8. Headcount Projection — the ROI feature

This is what the mess owner actually buys. Treat it as a first-class output.

```
projected(date, slot) =
    count(students with ACTIVE subscription covering date & slot, not BLOCKED)
  − count(approved mess_cuts covering date & slot)
  + count(guest tokens purchased for date & slot)
  + count(extra plates purchased for date & slot)
```

A cron job runs at the cutoff moment (12h before each meal), writes a **`headcount_snapshot`**, and locks it. The snapshot is the number the kitchen cooks to — the whole purpose of the 12-hour rule is to make the count freezable.

Post-service, compare `projected` vs `actual attendance` to produce a **variance report**. Persistent variance is the single most valuable analytic you can hand a mess owner, and it directly justifies your subscription price.

Push the live count to the staff dashboard via **Supabase Realtime** on the attendance table.

---

## 9. Scheduled Jobs

Every one of your business rules is time-based. Use Supabase `pg_cron` + Edge Functions, or Vercel Cron hitting protected `/api/cron/*` routes (guard with a secret header).

| Job                    | Schedule                    | Responsibility                               |
| ---------------------- | --------------------------- | -------------------------------------------- |
| `lock-headcount`       | 12h before each meal window | Snapshot & lock projected count              |
| `evaluate-dues`        | Daily 00:30 tenant-local    | ACTIVE → GRACE → BLOCKED transitions         |
| `generate-invoices`    | Daily 01:00                 | Issue invoices for cycles starting today     |
| `expire-subscriptions` | Daily 01:30                 | End-date passed → EXPIRED                    |
| `expire-extras`        | Daily 02:00                 | Unredeemed guest tokens past service date    |
| `send-reminders`       | Daily 09:00                 | Due-soon, grace-warning, expiry-warning push |
| `daily-digest`         | Daily 21:00                 | Admin summary: counts, collections, ratings  |

All jobs must be **idempotent and re-runnable** — cron will fire twice one day.

---

## 10. Testing Strategy

| Layer                | Tool                     | Coverage target     | What it protects                                                                                                       |
| -------------------- | ------------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Domain policies      | Vitest                   | **95%+**            | Billing math, cut eligibility, grace transitions                                                                       |
| Services / use cases | Vitest + in-memory fakes | 80%                 | Orchestration, authorization                                                                                           |
| Repositories         | Vitest + local Supabase  | Key paths           | RLS actually isolates tenants                                                                                          |
| API / webhooks       | Supertest                | All money endpoints | Signature verification, idempotency                                                                                    |
| E2E                  | Playwright               | 5 critical flows    | Subscribe→pay→scan→eat; apply cut→credit; overdue→block→pay→unblock; extras purchase→redeem; menu publish→student view |

Because the domain layer is pure, that 95% is cheap to reach and catches the bugs that cost real money.

**Non-negotiable test cases** — write these first:

- Duplicate Razorpay webhook → exactly one ledger entry
- Same QR scanned twice → second returns `ALREADY_SERVED`, no second attendance row
- Mess cut spanning a month boundary → correct per-month cap accounting
- Cut requested at 11h59m before the meal → rejected
- Blocked student's token request → denied
- Cross-tenant read attempt with a valid JWT → returns zero rows
- Credits exceeding invoice total → total floors at zero, surplus carries forward

---

## 11. Phased Delivery Plan

Each phase ends in something demonstrable. Do not start a phase before the previous one's exit criteria are met.

### Phase 0 — Foundations (Week 1)

Repo, TypeScript strict, ESLint with import boundaries, Prettier, Husky, CI on PR. Supabase project, migration workflow, generated types. `tenants`, `tenant_settings`, `profiles`, RLS baseline. Auth with role-based route groups. Seed script for one demo tenant. Sentry.

**Exit:** three roles can log in and land on their own shell; a cross-tenant query provably returns nothing.

### Phase 1 — Core Operating Loop (Weeks 2–4)

Student CRUD & onboarding. Plans & subscriptions (manual activation, no payment yet). Dynamic menu management + student menu view. QR token issuance + rotation. Staff scanner + verification + manual fallback. Attendance recording. Live headcount + snapshot cron.

**Exit:** the pilot hostel can run real lunch and dinner service, verified by QR, with a correct headcount. Billing still on paper. **This is the moment to put it in front of real students.**

### Phase 2 — Money (Weeks 5–7)

Ledger. Invoice generation. Razorpay orders + webhooks + idempotency. Manual payment override with audit. Mess-cut request flow with 12h and 5-day policy enforcement. Credit computation and application. Grace → block state machine + QR gating. Student billing history. Admin finance dashboard.

**Exit:** a full billing cycle completes end-to-end with zero manual spreadsheet work; a deliberately overdue account blocks and unblocks correctly.

### Phase 3 — Experience & Insight (Weeks 8–9)

Guest tokens & extra plates (purchase → redemption code → staff redemption). Feedback: 1–5 stars + comment, with rating trends per dish. Admin reports: collections, variance, cut patterns, attendance trends. PWA polish: installability, offline shell, push notifications. Staff scanner UX hardening.

**Exit:** a mess owner opens one dashboard in the morning and needs nothing else.

### Phase 4 — Productization (Weeks 10+)

Platform Super Admin console. Self-serve tenant onboarding with guided setup. **Layer B billing** — your SaaS subscription from mess owners (monthly/quarterly/6-month/annual). Per-tenant branding. Usage metering. Data export & GDPR-style deletion. Documentation and support runbook.

**Exit:** a second mess onboards without you writing a line of code.

**Deliberately deferred:** RFID tier, inventory/procurement, native apps, delivery/drop-point routing, multi-kitchen routing, vendor management.

---

## 12. Non-Functional Requirements

**Security:** RLS on every table; service-role key server-only; webhook signature verification; rate-limit `/api/qr/token` (per student) and `/api/qr/verify` (per device); no PII in logs; audit trail on all money and override actions.

**Performance:** QR verify p95 < 500 ms · student QR screen TTI < 1.5 s on 4G · admin dashboard < 2 s · headcount realtime lag < 3 s.

**Reliability:** Supabase PITR enabled; cron jobs idempotent; scanner degrades to offline queue; graceful handling of Razorpay downtime (fall back to manual marking).

**Observability:** Sentry for errors; structured logs with `tenant_id` + `request_id` on every entry; alerts on webhook failure rate, scan error rate, and cron non-execution.

**Accessibility & i18n:** WCAG AA contrast, keyboard-navigable admin, large touch targets on the scanner. Externalize strings from day one — Hindi and regional languages are near-certain requirements for student-facing screens.

---

## 13. Working with Claude Code

Practical guidance for the implementation phase.

### 13.1 Commit a `CLAUDE.md` at the repo root

Include: the layering rule and import boundaries; "money is integer paise, always"; "no business logic in components or Server Actions — call a use case"; "every table needs `tenant_id` and an RLS policy"; the migration workflow (never edit an applied migration); the test-first requirement for anything in `/core/policies`; and the tenant-timezone rule for all date derivation.

### 13.2 Build in vertical slices, not horizontal layers

Ask for "the complete mess-cut feature: policy + tests + repository + Server Action + UI" rather than "all the repositories." Vertical slices stay demonstrable and testable; horizontal layers accumulate untested scaffolding that all breaks at integration.

### 13.3 Write the policy tests before the policy

For billing, mess-cut eligibility, and grace transitions, give Claude Code the test cases from §10 first. These rules have edge cases that are obvious in a test and invisible in an implementation.

### 13.4 Guard the boundaries in review

The two things to check on every AI-generated PR:

1. Did business logic leak into a React component or Server Action?
2. Does every new query filter by `tenant_id`, and does every new table have an RLS policy?

These are the two regressions that are cheap to catch now and extremely expensive to catch in month six.

### 13.5 Migration discipline

One migration per logical change, sequentially numbered, never edited after being applied to any environment. Regenerate and commit Supabase types in the same PR as the migration so type errors surface immediately.

---

## 14. Open Items to Resolve Before Phase 2

1. **Mid-cycle joiners** — pro-rate the first invoice, or start billing from the next cycle? (Pro-rating is fairer; next-cycle is simpler. Pick one and encode it in `BillingPolicy`.)
2. **Quarterly plan cut cap** — 5 days per calendar month, or 15 pooled across the quarter? (Per-month is stricter and matches the stated rule; confirm with the owner.)
3. **Unused credits at subscription end** — carry forward to renewal, expire, or refund?
4. **Guest token pricing** — flat, or does it vary by meal slot?
5. **Partial-day cuts** — can a student cut only lunch and keep dinner? (Schema supports it via `meal_slots[]`; confirm it's operationally allowed.)
6. **Cancellation & refund policy** — mid-cycle cancellation currently undefined.

None block Phase 0 or Phase 1. All must be answered before the billing engine is written.
