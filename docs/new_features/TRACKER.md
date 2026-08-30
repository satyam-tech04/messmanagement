# New Features — Implementation Tracker

Companion to [IMPLEMENTATION.md](../IMPLEMENTATION.md), which tracks Phases 0–4 of the
original build. This file tracks the **new feature set** requested on 2026-08-30: the
three specs in this folder plus the handwritten note items that have no spec yet.

**Picking this up cold?** Read §"Build order" for what to do next, then §"Findings
register" for the traps already identified. Every finding ID (F1–F26) is referenced from
the task lists below — do not start a task without reading its cited findings.

Update this file the moment a task finishes. Never batch.

---

## Status legend

| Mark | Meaning                                                |
| ---- | ------------------------------------------------------ |
| ✅   | Done and verified against the live system              |
| 🚧   | In progress                                            |
| ⏸️   | Not started, unblocked                                 |
| 🔒   | Blocked — waiting on an open decision (see §Decisions) |
| ❔   | No spec exists yet                                     |

---

## Feature inventory

Traced from the handwritten requirements note, 2026-08-30.

| #   | Feature                                | Spec                                                           | Phase | Status                          |
| --- | -------------------------------------- | -------------------------------------------------------------- | ----- | ------------------------------- |
| 1   | Student login = mobile number          | —                                                              | —     | ✅ shipped (migrations 011–012) |
| 1b  | Send link + credentials via WhatsApp   | ❔ none                                                        | NF-5  | ❔                              |
| 2   | Grace period — pause / extend / resume | [grace period](./student_subscription_grace_period_feature.md) | NF-1  | ✅                              |
| 3   | À la carte menu & billing              | [meal billing](./meal-billing-feature-spec.md)                 | NF-3  | ⏸️                              |
| —   | Meal & plan pricing engine             | [meal pricing](./meal-pricing-feature-spec.md)                 | NF-2  | ⏸️                              |
| 4   | Meal planner                           | ❔ none                                                        | NF-4  | ❔                              |
| 5   | Feedback option                        | ❔ none                                                        | NF-4  | ❔                              |
| 6   | Special meal for selected days         | ❔ none                                                        | NF-4  | ❔                              |

**Already shipped:** item 1 is complete — `profiles.mobile` is a generated column,
`temporaryPasswordFromPhone` derives the first password from the same ten digits, and
`must_change_password` forces the change on first sign-in.

**Item 4 may already exist.** An admin week-planner for menus is live at `/admin/menu`.
Whether "meal planner" means that or something student-facing is unanswerable from the
note — see D-19.

---

## Build order

Ordered by risk to live data and by what unblocks what. NF-1 is genuinely gated by the
spec rewrite; NF-3 is independent and goes last despite being written down first.

### NF-0 — Rewrite the three specs against reality ⏸️

Documentation only, no code. This is what makes the rest safe to implement.

- [ ] Restate every money figure in **integer paise**, not decimal rupees (F2)
- [ ] Add `tenant_id`, RLS and tenant-leading indexes to every proposed table (F1)
- [ ] Replace invented table names with the ones that exist — `assignments` → `subscriptions` (F13)
- [ ] Fix the six dangling cross-references in the meal-billing spec (F19)
- [ ] Correct the two factual errors in the grace spec: audit log exists (F3), four roles not three (F4)
- [ ] Fold in the answers to D-15 … D-20

### NF-1 — Subscription pause ("grace period") ✅

Smallest build, highest immediate value. Lands almost entirely inside an existing policy.

- [x] `subscription_pauses` table — migration **013, applied + sealed** (F6)
- [x] `EXCLUDE USING gist` overlap constraint — a constraint, not an `if` (F12)
- [x] `end_date_before_pause` anchor, proven non-accumulating by test (F8)
- [x] `pause.policy.ts` + 46 tests, written first
- [x] State derived from dates — no cron needed for AC9's automatic resume (F9)
- [x] All dates through `src/core/time`; checked against `service_date` (F10)
- [x] `pauses` **required** on `StudentForVerification`, fetched in the same round trip (F5)
- [x] Blocked in `checkMealEligibility` — phone, scanner, manual and offline replay (F5)
- [x] `SUBSCRIPTION_PAUSED` error code + scanner outcome (amber, no manual override)
- [x] `npm run verify:pause` — live probe incl. the staff-RLS fail-open check
- [x] Server actions — save/modify, resume early, cancel (`pause-actions.ts`)
- [x] Admin UI on the student detail screen, with live grace-day preview (§20)
- [x] Student-facing paused panel on `/student` with the resume date (§12, AC10)
- [x] Writes to the existing `audit_log` — 4 new actions (F3)
- [x] `npm run verify` green: 891 tests, typecheck, lint; `npm run build` succeeds

**Live-verified so far:** migration applied and sealed; the embed returns an array; a
staff session can read pauses through RLS (had this policy been missing, every paused
student would have been served while every unit test still passed); the database refuses
an overlapping pause with `23P01` and allows a later non-overlapping one.

The counter-scan assertion in the probe is skipped when no meal window is open, and says
so — `verifyQrAttendance` checks the window before the student, so outside service hours
it would pass for the wrong reason. The manual fallback exercises the identical
`checkAccountEligibility` path and is asserted unconditionally.

**What shipped.** Migration 013 (`subscription_pauses`), `pause.policy.ts`,
`pause-actions.ts`, `pause-actions-ui.tsx`, the paused panel in `qr-display.tsx`, and the
`SUBSCRIPTION_PAUSED` code wired through `eligibility.policy.ts` so the student's phone,
the counter scanner and the manual fallback all refuse identically.

Two guards the project already had earned their keep during this build: the
timezone-discipline test rejected a hand-rolled `toISOString().slice(0, 10)` in the
preview helper (rewritten on `src/core/time`), and making `pauses` a **required** field on
`StudentForVerification` turned every missed fetch into a compile error rather than a
silently-served paused student.

### NF-2 — Pricing engine ✅

Additive columns only. Roughly 60% already exists.

- [x] Checked live plans first — 14 plans, none at zero, so `> 0` was safe (F18)
- [x] `meal_prices` table — migration **014, applied + sealed**
- [x] `base_premium_paise` + `discount_paise` on `plans`, with a CHECK tying them to `price_paise` (F15)
- [x] `plan_duration_days_snapshot`, `assignment_duration_days`, `calculated_price_paise`, `is_price_overridden` on `subscriptions`
- [x] `pricing.policy.ts` + 32 tests, written first; `plan.policy.ts` extended additively
- [x] Rate card on `/admin/plans`; plan form suggests a base premium and shows the final price live
- [x] Assign-plan takes days bought, previews the pro-rated price, allows an override
- [x] **D-03 amended** in [DECISIONS.md](../DECISIONS.md) — superseded by D-17 (F14)
- [x] The per-meal credit rate now follows what the student actually paid (F16)
- [x] `npm run verify:pricing` — live probe of the independence rule

**Live-verified:** the plan's price doubled underneath a student and their frozen price did
not move; the database refuses a plan whose price disagrees with `base − discount` (23514)
and refuses to sell more days than a plan holds; the 39 existing subscriptions backfilled
with calculated == charged and none flagged as overridden.

**Watch out:** migration 014 made `base_premium_paise` and three `subscriptions` columns
NOT NULL with no default, which broke **six** existing INSERTs — three in the app, two in
the verification scripts, and one in `scripts/seed.ts`. All six are fixed and each path
was exercised against the live database.

The reason only three were caught by `npm run typecheck` is worth remembering: `scripts/`
_is_ in `tsconfig.json`, but those scripts called `createClient()` with no `<Database>`
generic (`seed.ts` used `createClient<any>` outright), so their inserts were unchecked.
They are typed now, so the next migration that adds a NOT NULL column fails at compile
time instead of at 2am against production.

**Rule for the next migration:** adding a NOT NULL column without a default breaks every
INSERT that omits it. Grep for `from("<table>")` across `src`, `scripts` _and_ `tests`
before pushing — typecheck alone is not proof.

### NF-3 — Counter sales ("à la carte") ✅

Largest build, most independent. Nothing waits on it.

- [x] Named **Counter sales** everywhere; the Billing nav slot stays Phase 2's (F22)
- [x] Catalogue is `counter_items`, not "menu items" (F23)
- [x] Per-tenant numbering — `allocate_bill_number` / `allocate_counter_item_code`, row-locked (F1)
- [x] Line add = `INSERT` guarded by a unique index; merge = `increment_bill_line` RPC (F20)
- [x] `service_date` derived tenant-local at finalisation; revenue groups on it (F21)
- [x] Snapshot columns on `counter_bill_items`, proven immutable against a live rename (spec §12)
- [x] Four audit actions written for create / finalise / cancel / payment change (F24)
- [x] `counter-sales.policy.ts` + 38 tests, written first
- [x] Staff counter at `/staff/sales`; admin catalogue and daily takings under `/admin/counter-sales`
- [x] `npm run verify:counter-sales` — live probe

**Live-verified:** both messes independently issued `BILL-000001`, so numbering is per mess
rather than the single global sequence the spec asked for; ten concurrent `+1`s on one line
all landed (a read-modify-write would have lost most); renaming an item to "Renamed
Entirely" and repricing it ₹60 → ₹99 left every bill snapshot untouched; an OPEN bill
cannot be marked paid and finalising without a `service_date` is refused, both by CHECK
constraint rather than application code.

**Deviations from the spec, all deliberate:**

| Spec says                         | Built instead             | Why                                                                        |
| --------------------------------- | ------------------------- | -------------------------------------------------------------------------- |
| A7: one global bill sequence      | per-mess sequence         | two messes would interleave their books (F1)                               |
| A13: last write wins              | atomic increment          | open bills are a shared pool and counter Wi-Fi is unreliable (F20)         |
| §11: revenue by `finalized_at`    | revenue by `service_date` | UTC+5:30 would file every post-midnight bill under the previous day (F21)  |
| §3: hard delete allowed if unused | always soft delete        | the saving is nil; the risk of a used item vanishing from a receipt is not |

### NF-4 — Unspecced note items 🚧 next · needs D-19

- [ ] Establish what item 6 ("special meal for selected days") means, then scope
- [ ] Confirm whether item 4 is the existing `/admin/menu` planner
- [ ] Feedback — deferred; listed in IMPLEMENTATION.md as a later-phase idea

### NF-5 — WhatsApp credential delivery ❔ D-20

- [ ] Decide `wa.me` pre-filled link vs. a real Business API integration

---

## Decisions

Open decisions are numbered continuing from [DECISIONS.md](../DECISIONS.md), and move
there once resolved.

| ID   | Question                                         | Blocks | Status      |
| ---- | ------------------------------------------------ | ------ | ----------- |
| D-15 | Can a pause start today?                         | NF-1   | ✅ resolved |
| D-16 | Are counter bills linked to students?            | NF-3   | ✅ resolved |
| D-17 | Pro-rating formula                               | NF-2   | ✅ resolved |
| D-18 | Who owns the post-pause end date                 | NF-1   | ✅ resolved |
| D-19 | What does "special meal for selected days" mean? | NF-4   | ⏳ open     |
| D-20 | WhatsApp: `wa.me` link or Business API?          | NF-5   | ⏳ open     |

### D-15 — A pause may start today, never in the past

**Decided:** 2026-08-30 by the project owner, overriding spec §5.1 and AC2.

**Why:** an admin learning at 9am that a student went home this morning must be able to
pause immediately. Under the spec's "tomorrow or later" rule they wait a day, during
which the student eats every meal — the exact situation the feature exists to prevent.

**Consequence:** a pause starting today takes effect for meals not yet served today;
meals already served stand. Past start dates remain rejected.

### D-16 — Counter sales are a standalone cash register

**Decided:** 2026-08-30. Spec §13 is built as written — `person_name` is plain text with
no link to any student record.

**Consequence:** a subscriber's extra purchases cannot be added to what they owe. If that
is wanted later it is a new feature, not a retrofit of every bill row.

### D-17 — Pro-rating is per-day, rounded up

**Decided:** 2026-08-30, superseding **D-03**. `ceil(final_price ÷ plan_days × assignment_days)`,
computed in paise.

**Why:** easier to explain to a student or parent than a per-meal derivation.

**Consequence:** D-03 in [DECISIONS.md](../DECISIONS.md) must be amended in the same
commit as the NF-2 pricing work. The per-meal rate stays in use for mess-cut credits —
only joiner pro-rating changes.

### D-18 — The end date is computed, pre-filled, and overridable

**Decided:** 2026-08-30. The system computes `end_date_before_pause + grace_days` and
pre-fills it; the admin may change it; **both** the computed and entered values are
stored.

**Why:** it satisfies spec §7 (never silently replace what the admin typed), §8 (the
student gets the paused days back), and §22 (repeated edits must not accumulate) at the
same time. `end_date_before_pause` — the subscription's end date at the moment the pause
was first created — is the anchor that makes every recalculation idempotent.

---

## Findings register

From the spec review of 2026-08-30. Verified against migrations 001–012 and the code as
of `2e5beb9`. **Blockers would corrupt live data or fail CI if built as written.**

### Cross-cutting — all three specs

| ID  | Severity    | Finding                                                                                                                                                                                                                                                    |
| --- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | 🔴 Blocker  | No spec mentions multi-tenancy. Eleven proposed tables, zero `tenant_id`. Billing A7's "single continuous sequence for the lifetime of the system" is wrong — two messes would interleave bill numbers. Use migration 010's row-locked per-tenant counter. |
| F2  | 🔴 Blocker  | All three denominate money in decimal rupees. Rule 3 is integer paise, enforced by ESLint in `src/core`. Pricing §6.6 prescribes `Math.ceil(rawPrice - 1e-9)` — an epsilon for float error the codebase avoids by never entering it.                       |
| F3  | 🟠 Conflict | Grace §25 asserts "no audit functionality exists". `audit_log` has existed since migration 001, with 20 call sites. Read §25 as prohibiting a _new_ audit system; write to the existing one.                                                               |
| F4  | 🟠 Conflict | Grace §1 says three roles. There are four — `SUPER_ADMIN` is the support account. `role === "ADMIN"` locks it out of the feature most likely to generate a support call.                                                                                   |

### Grace period

| ID  | Severity    | Finding                                                                                                                                                                                                                                                                                                  |
| --- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F5  | 🟢 Built    | `checkMealEligibility` is called by both token issuance and counter verification. One check there satisfies all of §10/§19 — phone, scanner, manual fallback and offline replay. Needs pause fields on `StudentForVerification` and the one-round-trip select (500 ms p95 budget).                       |
| F6  | 🔴 Blocker  | `student_status.GRACE` already means _unpaid dues, still eats_ — the policy says "GRACE deliberately passes". The new feature means _paused, must not eat_. Reusing it either feeds paused students or refuses dues-grace students at the counter. Build `subscription_pauses`; call it a pause in code. |
| F7  | 🔴 Blocker  | §7 and §8 contradict: §8 says six paused days = six extra days; §7 says the admin types the end date and the system must not overwrite it. Also, credits divide by `duration_days`, not the date span — extending one without the other corrupts the credit rate.                                        |
| F8  | 🔴 Blocker  | §22 forbids accumulating extensions across repeated edits but does not say how. With a mutable admin-typed end date it is unanswerable. Fix: store `end_date_before_pause`; every recalc is `end_date_before_pause + actual_paused_days`, idempotent under any number of edits.                          |
| F9  | 🟠 Conflict | §13's statuses assume a scheduler. The only cron snapshots headcounts. This already bit the project once — `subscription-state.ts` exists because nothing marks subscriptions `EXPIRED`. Derive Active/Completed from dates.                                                                             |
| F10 | 🟠 Conflict | Every date rule in §5 is written without a timezone. Check against the meal's `service_date`, not `now()` — a 00:30 dinner belongs to the previous day.                                                                                                                                                  |
| F11 | 🔵 Gap      | §3 excludes only cancelled subscriptions; expired ones are equally ineligible. §5.1's "not today" rule fights the real workflow (see D-15).                                                                                                                                                              |
| F12 | 🔵 Gap      | "No overlapping grace periods" must be a DB constraint, not an application check — precedent: `subscriptions_one_active_per_student`.                                                                                                                                                                    |

### Pricing

| ID  | Severity    | Finding                                                                                                                                                                                                                                                             |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F13 | 🔴 Blocker  | Re-specifies two existing tables under new names. `assignments` = `subscriptions`; the spec's plan `status: Active\|Retired` = existing `is_active`. Built literally, produces a parallel subscription system — the exact thing the grace spec's own §29.9 forbids. |
| F14 | 🟠 Conflict | Pro-rating contradicts D-03. D-03: per-meal rate, floored, remainder stays with the mess (tested invariant). Spec: per-day rate, rounded up. On ₹3,400 / 30 days taken for 17: spec ₹1,927, D-03 ₹1,926.44.                                                         |
| F15 | 🟠 Conflict | Adding `final_price` creates two prices per plan. Keep `price_paise` authoritative; add `base_premium_paise` + `discount_paise` as the derivation record with a CHECK tying them together.                                                                          |
| F16 | 🔵 Gap      | A price override silently changes that student's per-meal mess-cut credit rate. Arguably correct, certainly surprising, unmentioned.                                                                                                                                |
| F17 | 🟢 Built    | `meal_slot` is already exactly BREAKFAST\|LUNCH\|SNACKS\|DINNER, and `plans.duration_days` is already a free integer (1–400). No migration needed for either.                                                                                                       |
| F18 | 🔵 Gap      | §5.4's `final_price > 0` is stricter than the existing `>= 0`. Campus Crave has 8 live plans; if any is zero the migration fails against production, with no local rehearsal (D-04).                                                                                |

### Counter sales

| ID  | Severity    | Finding                                                                                                                                                                                                                              |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F19 | 🔴 Blocker  | Six cross-references point at sections 25, 27, 49 and others that do not exist — the document ends at §17. Its own instruction is "stop and ask rather than guessing", so an agent following one halts. Right targets: §7, §7, §16.  |
| F20 | 🔴 Blocker  | A13's "last write wins" is wrong for _this_ counter: A2 makes open bills a shared pool, and rule 5 exists because flaky counter Wi-Fi is documented. Fix costs nothing — `INSERT` and atomic increment instead of read-modify-write. |
| F21 | 🔴 Blocker  | §11 keys daily revenue on `finalized_at`. India is UTC+5:30, so every bill finalized 00:00–05:30 local lands on the previous day. Store a tenant-local `service_date` and group on that.                                             |
| F22 | 🟠 Conflict | "Billing" already exists in both nav sidebars, greyed out and badged Phase 2, reserved for invoices and Razorpay. Two screens named Billing showing unrelated numbers.                                                               |
| F23 | 🟠 Conflict | Third thing called "menu": the daily published `menus` table, plans' included meal slots, and now priced sellable items.                                                                                                             |
| F24 | 🟠 Conflict | Payment status is mutated in place, against rule 4 (financial records immutable). Acceptable for a cash pad, but should be a decision — append toggles to `audit_log`.                                                               |
| F25 | 🔵 Gap      | §13 forbids linking a bill to any person record, so a subscriber's extras can never reach their account. Coherent as a cash register, but the note said "à la carte". See D-16.                                                      |
| F26 | 🟢 Built    | `app.is_staff_or_admin()` and `app.is_admin()` already exist as SQL helpers reading JWT claims. RLS for bills and catalogue is a one-liner each.                                                                                     |

---

## Constraints that apply to every task here

Restated from [CLAUDE.md](../../CLAUDE.md) because all three specs violate at least one:

1. **Money is integer paise.** `BIGINT` in Postgres, branded `Paise` in TypeScript.
2. **Business logic lives in `src/core`.** A Server Action validates, builds a
   `TenantContext`, calls one use case, maps the result. No `if` on business rules in `.tsx`.
3. **Test-first for `src/core/policies`.** Cases before implementation; 95% threshold.
4. **`tenant_id` on every table, index and query**, enforced by RLS _and_ the app layer.
5. **Idempotency by database constraint**, never an application `if`.
6. **Every date through `src/core/time`.** Never `toISOString().slice(0, 10)`.
7. **One migration per logical change**, sequentially numbered, sealed after push.
   Next number is **013**.
8. **Four designed UI states** per list: loading, empty, error, populated.
