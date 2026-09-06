# Meal Pricing Feature — Implementation Specification

## 1. Purpose & Scope

This document specifies the complete pricing engine for the meal subscription system, covering three independent, hierarchical pricing layers:

1. **Meal Price** — the standard selling price of a single meal type.
2. **Plan Price** — the package price for a selected combination of meals over a default duration.
3. **Assignment Price** — the actual price charged to a specific student for a specific duration.

The single most important architectural rule governing this entire feature is:

> **Never dynamically recalculate historical pricing from current meal rates or current plan values.**

Each layer, once created, freezes the pricing values relevant to it. Changes at a higher layer (Meal Price, Plan) must never retroactively alter values already frozen at a lower layer (Plan, Assignment).

This spec is intended to be handed directly to a coding agent. It includes data model, UI behavior, calculation logic, validation rules, edge cases, and acceptance criteria. No business-rule decisions should need to be made by the implementer beyond what is written here — if a case is not covered, treat it as **out of scope** and flag it rather than guessing.

---

## 2. Terminology

| Term | Meaning |
|---|---|
| Meal Price | Standard selling price of one meal (Breakfast / Lunch / Snacks / Dinner) |
| Plan Price | Package price for a selected set of meal types + a default duration |
| Assignment Price | Actual price charged to a particular student for a particular duration |
| Base Premium | Auto-calculated (and admin-editable) starting price of a plan, before discount |
| Discount | Flat amount subtracted from Base Premium |
| Final Price | `Base Premium − Discount`; the frozen price of the plan |
| Calculated Price | System-computed price for a student assignment, derived from Final Price |
| Final Assignment Price | The price actually charged — either the Calculated Price or an admin override |

---

## 3. Pricing Hierarchy Overview

```
Meal Price  →  Plan Price  →  Assignment Price
(master rate)  (frozen snapshot) (frozen snapshot)
```

- Meal Price changes affect **only newly created plans** going forward.
- Plan Price changes (Base Premium/Discount) affect **only that plan**, and only before it has been... actually plans are frozen at creation — see §5.
- Assignment Price is always derived from the plan's Final Price at the **moment of assignment**, and once created is itself frozen and independent of later plan changes.

---

## 4. Layer 1 — Meal Pricing

### 4.1 Data Model

Table: `meal_prices`

| Field | Type | Notes |
|---|---|---|
| id | PK | |
| meal_type | enum(Breakfast, Lunch, Snacks, Dinner) | unique |
| price | decimal | current master rate, in ₹ |
| updated_at | timestamp | |

### 4.2 Behavior

- There is exactly one active price per meal type at any time (a simple current-rate table, not a history table — history is implicitly preserved via frozen Plan/Assignment snapshots).
- Admin can update a meal type's price at any time.
- **Updating a meal price must not modify any existing Plan or Assignment record.** These records store their own copies of the values they need (see §5 and §6) and must never join back to `meal_prices` for display or calculation.

### 4.3 Acceptance Criteria

- [ ] Changing a meal price does not change the Base Premium, Final Price, or Discount of any existing plan.
- [ ] Changing a meal price does not change the Calculated Price or Final Assignment Price of any existing assignment.
- [ ] A newly created plan uses the meal prices in effect at the moment of its creation.

---

## 5. Layer 2 — Plan Pricing

### 5.1 Data Model

Table: `plans`

| Field | Type | Notes |
|---|---|---|
| id | PK | |
| name | string | |
| meal_types | array/enum set | subset of {Breakfast, Lunch, Snacks, Dinner} |
| default_duration_days | integer | admin-entered |
| base_premium | decimal | auto-calculated, then admin-editable before save |
| discount | decimal | flat amount, admin-entered |
| final_price | decimal | `base_premium − discount`, computed and frozen at creation |
| status | enum(Active, Retired) | see §8 |
| created_at | timestamp | |
| meal_prices_snapshot | JSON (optional but recommended) | the individual meal rates used to compute base_premium, for audit/display purposes only — never used for recalculation |

**Important:** `base_premium`, `discount`, and `final_price` are stored columns, not computed/virtual fields. Once written at creation time, they never change automatically.

### 5.2 Plan Creation Flow (UI Behavior)

1. Admin selects one or more meal types (Breakfast / Lunch / Snacks / Dinner).
2. Admin selects the default duration (in days).
3. System automatically calculates:
   ```
   Auto Base Premium = (sum of selected meal prices) × default_duration_days
   ```
   This value pre-fills the "Base Premium" field.
4. Admin **may** edit the Base Premium field before saving (it is not locked to the auto-calculated value).
5. Admin enters a flat Discount amount.
6. System computes and displays:
   ```
   Final Price = Base Premium − Discount
   ```
   live, as the admin types.
7. On save:
   - Validate (see §5.4).
   - Persist `base_premium`, `discount`, and `final_price` as static values.
   - Plan is now immutable with respect to these three fields (see §5.5 — editing an existing plan's pricing is out of scope unless explicitly built as "create a new plan version"; do not silently allow in-place edits to a plan that already has assignments — see §8.4).

### 5.3 Worked Example

```
Lunch ₹60 + Dinner ₹60
Duration: 30 days
Auto Base Premium = (60 + 60) × 30 = ₹3,600
Admin changes Base Premium → ₹3,800
Discount → ₹200
Final Price → ₹3,600
```

The plan permanently stores `base_premium = 3800`, `discount = 200`, `final_price = 3600`.

### 5.4 Validation Rules

- [ ] At least one meal type must be selected.
- [ ] `default_duration_days` must be a positive integer.
- [ ] `discount` must be ≥ 0.
- [ ] `discount` **cannot exceed** `base_premium`.
- [ ] `final_price` (`base_premium − discount`) **cannot be ₹0 or negative** — reject save and show a validation error if it would be.
- [ ] `base_premium` must be > 0.

### 5.5 Immutability After Creation

- Once a plan is saved, `base_premium`, `discount`, and `final_price` are treated as a frozen snapshot.
- If the product later needs an "edit plan pricing" feature, it must be implemented as either:
  - (a) disabled entirely once the plan has ≥1 assignment, or
  - (b) editing only affects **new** assignments made after the edit, never existing ones.
  - This spec does not define an edit-pricing UI; treat plan pricing fields as write-once via the creation flow unless a separate spec is provided. If the existing system already allows editing plan fields, editing base_premium/discount must **never** cascade to existing assignments (reaffirming §7's independence rule).

---

## 6. Student Assignment — Assignment Pricing

### 6.1 Data Model

Table: `assignments`

| Field | Type | Notes |
|---|---|---|
| id | PK | |
| student_id | FK | |
| plan_id | FK | |
| plan_final_price_snapshot | decimal | copy of the plan's `final_price` at time of assignment |
| plan_duration_snapshot | integer | copy of the plan's `default_duration_days` at time of assignment |
| assignment_duration_days | integer | admin-entered, ≤ plan_duration_snapshot |
| calculated_price | decimal | system-computed, see §6.3 |
| final_assignment_price | decimal | equals calculated_price unless admin overrides |
| is_overridden | boolean | true if admin manually changed the price |
| created_at | timestamp | |

**Important:** `plan_final_price_snapshot` and `plan_duration_snapshot` must be copied onto the assignment record at creation time. The assignment must never join to the live `plans` table to compute or re-display its price.

### 6.2 Assignment Creation Flow (UI Behavior)

1. Admin selects Student → selects Plan → enters Duration (in calendar days).
2. Duration validation:
   - Must be a positive integer.
   - Cannot exceed the plan's `default_duration_days`.
3. System calculates and displays **Calculated Price** (see formula below), read-only initially.
4. Admin may override this into a **Final Assignment Price** field.
5. On save, both `calculated_price` and `final_assignment_price` are persisted (even if equal), along with `is_overridden`.

### 6.3 Calculation Formula

```
Assignment Price = RoundUp( Plan Final Price ÷ Plan Duration × Assignment Duration )
```

- Uses the plan's **frozen** Final Price, never the live/current meal rates or a recalculated plan value.
- Rounding: round **up** (ceiling) to the nearest whole ₹1. No decimal/paisa amounts are ever charged.
- Duration is calendar days — it does not depend on which meals were actually served/consumed. A missed meal does not reduce the price.

### 6.4 Worked Example

```
Plan Final Price: ₹3,400
Plan Duration: 30 days
Student Duration: 17 days

3,400 ÷ 30 × 17 = 1,926.666...
Round up → ₹1,927

Calculated Price = ₹1,927
```

If the admin overrides to ₹1,900:
- `final_assignment_price = 1900`
- `is_overridden = true`
- This override applies **only** to this one assignment record. It must not write back to the plan or affect any other student's assignment on the same plan.

### 6.5 Validation Rules

- [ ] `assignment_duration_days` must be a positive integer.
- [ ] `assignment_duration_days` cannot exceed `plan_duration_snapshot`.
- [ ] `calculated_price` must always be computed via the rounding-up formula above — never floor, never round-to-nearest.
- [ ] `final_assignment_price` (whether default or overridden) must be a whole number (no decimals).
- [ ] An override value should be ≥ 0 at minimum (define a sane floor, e.g. ≥ ₹1, since ₹0 charges likely aren't intended — flag this to product if not already decided; not explicitly specified in source discussion for overrides, only for plan Final Price).

### 6.6 Rounding Implementation Note for Developers

Use ceiling-based rounding on the raw decimal result, not string-based rounding, to avoid floating-point artifacts. E.g. in a language with floats:

```js
const rawPrice = (planFinalPrice / planDuration) * assignmentDuration;
const assignmentPrice = Math.ceil(rawPrice - 1e-9); // epsilon guards against float error like 59.999999999
```

(Use a decimal/fixed-point library if the stack has one available, in preference to raw floats, given this is a financial calculation.)

---

## 7. Immutability & Independence Rules (Core Architectural Principle)

This is the section a coding agent should treat as **non-negotiable**, cutting across all layers:

| Action | Effect on Plans | Effect on Assignments |
|---|---|---|
| Change a Meal Price | No effect on existing plans | No effect on existing assignments |
| Change a Plan's Base Premium / Discount | Affects only that plan (if edit is even allowed — see §5.5) | **No effect** on existing assignments already made against that plan |
| Change/override a Student's Assignment | N/A | Affects **only** that one assignment record |

Concretely, for implementation:
- Never compute Plan pricing at read-time from `meal_prices`. Compute once at creation, store, and read from storage thereafter.
- Never compute Assignment pricing at read-time from `plans`. Compute once at creation (using the plan's values *at that moment*), store both the snapshot inputs and the result, and read from storage thereafter.
- Any report, invoice, or history screen that shows a past plan or past assignment must display the **frozen stored values**, not a live recalculation.

### 7.1 Acceptance Criteria

- [ ] Changing any meal price and then viewing an existing plan shows unchanged Base Premium / Discount / Final Price.
- [ ] Changing any meal price and then viewing an existing assignment shows unchanged Calculated Price / Final Assignment Price.
- [ ] If plan editing is permitted and a plan's Base Premium or Discount is changed, all pre-existing assignments under that plan remain unchanged.
- [ ] Overriding one student's Final Assignment Price does not alter the Calculated Price or Final Assignment Price of any other student assigned to the same plan.
- [ ] Overriding one student's Final Assignment Price does not alter the plan's Final Price.

---

## 8. Plan Lifecycle

### 8.1 Deletion

- Plans can be deleted according to whatever deletion behavior already exists in the system (this spec does not change existing deletion behavior/permissions).
- Deletion of a plan should be reconciled with existing assignments per current system conventions — at minimum, deleting a plan **must not** delete or corrupt historical assignment records, since those records carry their own frozen snapshot data (`plan_final_price_snapshot`, `plan_duration_snapshot`) and do not depend on the plan row continuing to exist for pricing purposes. (Whether deletion is a hard delete or soft delete, and whether it's blocked when assignments exist, follows existing system behavior unless otherwise specified.)

### 8.2 Retirement / Inactivation

- Introduce a `status` field on `plans`: `Active` | `Retired` (add this if it doesn't already exist).
- A **Retired** plan:
  - Cannot be selected for new assignments (hide/disable it in the plan-selection UI for new assignments).
  - Remains fully visible in historical contexts (existing assignment records, reports).
  - Retains all of its own pricing fields unchanged.
- Retiring a plan does not affect any existing assignment's `final_assignment_price` or `calculated_price`.

### 8.3 Changing a Student's Plan

- A student can be moved from one plan to another (or have their current assignment ended and a new one created — follow whatever pattern the existing assignment model uses for "changing" vs. "ending + creating new").
- Changing a student's current plan **must not rewrite** the historical pricing of the previous assignment record. The old assignment row keeps its original `plan_final_price_snapshot`, `plan_duration_snapshot`, `calculated_price`, and `final_assignment_price` exactly as they were.
- The new plan assignment is created as a brand-new `assignments` row, following the normal creation flow in §6.

### 8.4 Editing a Plan That Already Has Assignments

- Not explicitly defined as a UI feature in the source requirements. Recommended default: **disallow editing** `base_premium`/`discount`/`meal_types`/`default_duration_days` on a plan once it has one or more assignments, to avoid ambiguity about what "editing a plan" should do to its Final Price semantics. If the existing system already supports plan editing, at minimum enforce: **no cascading recalculation of any existing assignment**, per §7.

### 8.5 Acceptance Criteria

- [ ] A retired plan does not appear as a selectable option when creating a new assignment.
- [ ] A retired plan's existing assignments continue to display and function normally (e.g., in invoices/history).
- [ ] Deleting a plan (per existing deletion rules) does not remove or blank out pricing fields on assignments that reference it.
- [ ] Changing a student to a new plan preserves the old assignment record untouched and creates a separate new assignment record with its own fresh snapshot/calculation.

---

## 9. Edge Cases Checklist

| Case | Expected Behavior |
|---|---|
| Discount entered equal to Base Premium | Final Price = 0 → **rejected** by validation (Final Price cannot be ₹0) |
| Discount entered greater than Base Premium | **Rejected** by validation |
| Assignment duration equals plan default duration | Assignment Price should equal the plan's Final Price exactly (no rounding artifact, since duration ratio = 1) |
| Assignment duration = 1 day | Calculated using the same formula; rounds up as normal |
| Division result already a whole number | Round-up has no visible effect; price = exact value |
| Admin overrides Final Assignment Price to same value as Calculated Price | `is_overridden` can be `true` or `false` depending on implementation preference — recommend setting `false` if the value matches exactly, `true` if the admin explicitly interacted with the override field and changed it, even to an equal value. Pick one convention and apply consistently. |
| Meal price changed after a plan was created but before any assignment on it | Plan retains its original Base Premium/Final Price; unaffected |
| Multiple students assigned to the same plan with different durations | Each gets an independently calculated `calculated_price`; none affect each other |
| Plan retired while it still has active (ongoing) assignments | Existing assignments continue unaffected; only new assignment creation is blocked |

---

## 10. Summary of Formulas

```
Auto Base Premium        = Σ(selected meal prices) × default_duration_days
Final Price (Plan)       = Base Premium − Discount            [must be > 0]
Calculated Price (Assgn) = RoundUp( Plan Final Price ÷ Plan Duration × Assignment Duration )
Final Assignment Price   = Calculated Price, unless admin overrides
```

## 11. Non-Goals / Out of Scope

- This spec does not define invoicing, payment collection, or refund logic.
- This spec does not define a UI for retroactively editing a plan's pricing after assignments exist (see §8.4) — build that only if explicitly requested, following the immutability rule.
- Meal price history/audit trail beyond what's needed to freeze Plan-level snapshots is not required by this spec (though storing `meal_prices_snapshot` JSON on the plan, as suggested in §5.1, is a nice-to-have for support/debugging).
