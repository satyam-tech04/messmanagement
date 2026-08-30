> ## ⚠️ AS-BUILT AMENDMENTS — read before implementing anything below
>
> **Status: shipped 2026-08-30** (commit `f776d52`, migration 015). The text below is the
> original requirement as written, preserved unchanged. Where the built system differs, the
> table here is correct and the body below is not.
>
> | §          | What the spec says                                            | What was built, and why                                                                                                                                                                                                                                                                                                                                         |
> | ---------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | title      | "Meal Billing"                                                | **Counter sales.** The admin sidebar already reserves a _Billing_ entry for Phase 2 subscription invoices; two screens of that name showing unrelated totals is how an owner loses track of what the mess earned.                                                                                                                                               |
> | §2.1       | "Menu Item"                                                   | **`counter_items`.** `menus` already means the daily published menu, and plans separately carry included meal slots — this would have been the third thing called "menu".                                                                                                                                                                                       |
> | A7         | "a single continuous sequence for the lifetime of the system" | **Per mess.** Two messes sharing a sequence would interleave their books and leave each owner with gaps they cannot explain. Both counters advance under a row lock, the pattern migration 010 set for roll numbers.                                                                                                                                            |
> | A13        | "no optimistic locking… last write wins"                      | **Overridden.** A2 makes every open bill a shared pool, and this deployment's counter Wi-Fi is documented as unreliable, so a read-modify-write would silently lose lines. Adding a line is an `INSERT` guarded by a unique index on `(bill, item, price)`; merging is an increment inside the `UPDATE`. The probe fires ten concurrent `+1`s and all ten land. |
> | §11        | revenue keyed to `finalized_at`                               | **Keyed to a tenant-local `service_date`.** India is UTC+5:30, so taking the date off the timestamp would file every bill finalised between midnight and 05:30 under the previous day — a nightly error for a mess that serves dinner.                                                                                                                          |
> | §3         | hard delete allowed for an unused item                        | **Always a soft delete.** The saving is nil and the check would have to be exactly right forever, or a used item vanishes from somebody's receipt.                                                                                                                                                                                                              |
> | throughout | `decimal`                                                     | **Integer paise**, `bigint`.                                                                                                                                                                                                                                                                                                                                    |
> | —          | not mentioned                                                 | Every table carries **`tenant_id`**, RLS and tenant-leading indexes. The spec never mentions multi-tenancy.                                                                                                                                                                                                                                                     |
> | §2.2       | `payment_status` mutated in place                             | Kept, but every toggle is appended to **`audit_log`** — the row alone only remembers who touched it last, and "when was this marked paid" is exactly what gets asked later.                                                                                                                                                                                     |
>
> **Broken cross-references in the original.** The document was renumbered and six citations
> were not updated. It ends at §17, so these point at nothing:
>
> | Cited                                       | Actually                           | Where            |
> | ------------------------------------------- | ---------------------------------- | ---------------- |
> | "Section 27"                                | §7 (finalize confirmation)         | A4               |
> | "Section 25"                                | §7 (cannot finalize an empty bill) | A6               |
> | "Section 49"                                | §16 (out of scope)                 | A9               |
> | "Section 15 — No Customer Management"       | §13                                | §1               |
> | "Section 8 — no zero-total finalized bills" | §7                                 | §7 preconditions |
>
> This matters because the document instructs the reader to _stop and ask_ when something is
> not covered — so following a dangling reference halts the work.
>
> Live proof: `npm run verify:counter-sales`. Full reasoning: [TRACKER.md](./TRACKER.md) findings F19–F26.

# Meal Billing Feature — Implementation Specification

> **Instructions for the coding model:** This document is the single source of truth for this feature. Implement exactly what is described here. Do not invent features, fields, screens, or business rules beyond what is written. Where a decision was ambiguous in the original request, Section 0 states the **resolved assumption** to build against — follow it unless the user explicitly overrides it. If you encounter a situation not covered by this document, stop and ask rather than guessing.

---

## 0. Resolved Assumptions (read first)

These items were ambiguous in the original functional description. Build against these defaults unless told otherwise:

| #   | Topic                      | Resolved Assumption                                                                                                                                                                 |
| --- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Staff identity             | Staff members log in individually (simple username/password or existing app auth). Every bill and action is attributed to the logged-in staff user.                                 |
| A2  | Visibility of active bills | All active bills are visible and editable by **any** logged-in staff user (shared pool), not restricted to the creator. This matches the "switch freely between bills" requirement. |
| A3  | Audit trail                | Every bill stores `created_by`, `finalized_by`, `cancelled_by`, and `payment_updated_by` (user reference), in addition to the timestamps already required by the spec.              |
| A4  | Cancel confirmation        | Cancelling an open bill requires the same style of confirmation dialog as finalizing (Section 27), especially if the bill has items.                                                |
| A5  | Editing person name        | Person Name can be edited while the bill is Open. It becomes locked once Finalized or Cancelled.                                                                                    |
| A6  | Removing the last item     | Removing the last remaining item from an open bill is allowed; the bill simply becomes an empty Open bill (Section 25 rules still apply — it cannot be finalized while empty).      |
| A7  | Bill numbering             | Bill numbers are a single continuous sequence for the lifetime of the system (never reset daily/yearly), e.g. `BILL-000001`, `BILL-000002`, ...                                     |
| A8  | Fractional quantities      | Quantities are **whole numbers only** (integers ≥ 1) for v1, since example units (plate/bowl/piece/cup) are whole-unit items. Do not build decimal quantity support.                |
| A9  | Un-finalizing              | There is **no** "un-finalize" or void workflow in v1. A finalized bill is permanently locked. This is explicitly out of scope (see Section 49).                                     |
| A10 | Payment status changes     | Both staff and admin may change Unpaid → Paid and Paid → Unpaid on a finalized bill. This never changes the bill total or revenue inclusion.                                        |
| A11 | Menu price validation      | Menu item price must be a positive number greater than 0. Reject zero or negative prices at entry.                                                                                  |
| A12 | Categories                 | Do not build a category field/UI unless explicitly requested later. Omit entirely for v1.                                                                                           |
| A13 | Concurrency                | No optimistic locking / conflict resolution is required for v1. Last write wins. This is a small internal tool, not a high-concurrency system.                                      |

---

## 1. Feature Overview

The Meal Billing feature allows staff to create and manage individual meal bills for people who come to eat. It has two primary areas:

1. **Admin** — Menu Management and Billing/Revenue View
2. **Staff** — Multi-Person Meal Billing

It behaves like a simple restaurant/hotel billing system.

Core principles:

- Each visit by a person creates a **new independent bill**. The person is **not** a reusable customer record (see Section 15 — No Customer Management).
- Multiple people can be eating simultaneously; staff must be able to maintain multiple open bills at once and switch freely between them.
- The system automatically calculates each bill from menu items and quantities. Staff never manually enter prices or totals.
- There are **no taxes, GST, discounts, or additional charges**. The administrator's price is the final selling price.

---

## 2. Core Entities

### 2.1 Menu Item

Represents something the business serves.

| Field       | Type                         | Notes                                                                |
| ----------- | ---------------------------- | -------------------------------------------------------------------- |
| `item_id`   | internal PK                  | not shown to users                                                   |
| `item_code` | string, unique               | system-generated (e.g. `M001`), never reused, immutable once created |
| `item_name` | string                       | editable                                                             |
| `price`     | decimal                      | > 0, editable, no manual override by staff                           |
| `unit`      | string                       | e.g. "Plate", "Bowl", "Piece", "Cup"                                 |
| `status`    | enum: `Active` \| `Inactive` | controls visibility for new bills only                               |

### 2.2 Bill

Represents one person's visit/meal transaction.

| Field                | Type                                       | Notes                                                        |
| -------------------- | ------------------------------------------ | ------------------------------------------------------------ |
| `bill_id`            | internal PK                                | not shown to users                                           |
| `bill_number`        | string, unique                             | system-generated, sequential, immutable (e.g. `BILL-000001`) |
| `person_name`        | string                                     | bill-level only, editable while Open (A5), locked after      |
| `status`             | enum: `Open` \| `Finalized` \| `Cancelled` | see Section 8                                                |
| `payment_status`     | enum: `Unpaid` \| `Paid`                   | default `Unpaid`, independent of bill status                 |
| `created_at`         | datetime                                   | auto-captured                                                |
| `created_by`         | user ref                                   | auto-captured (A3)                                           |
| `finalized_at`       | datetime, nullable                         | auto-captured on finalize                                    |
| `finalized_by`       | user ref, nullable                         | auto-captured (A3)                                           |
| `cancelled_at`       | datetime, nullable                         | auto-captured on cancel                                      |
| `cancelled_by`       | user ref, nullable                         | auto-captured (A3)                                           |
| `payment_updated_by` | user ref, nullable                         | auto-captured on payment status change (A3)                  |
| `total_amount`       | decimal                                    | always derived, never manually entered                       |
| `bill_items`         | list of Bill Item                          | see below                                                    |

### 2.3 Bill Item

Represents a menu item added to a specific bill, with a full historical snapshot.

| Field                 | Type                   | Notes                                                            |
| --------------------- | ---------------------- | ---------------------------------------------------------------- |
| `bill_item_id`        | internal PK            |                                                                  |
| `menu_item_ref`       | reference to Menu Item | for traceability only; never used to recompute historical values |
| `item_code_snapshot`  | string                 | copied at time of add, immutable thereafter                      |
| `item_name_snapshot`  | string                 | copied at time of add, immutable thereafter                      |
| `unit_snapshot`       | string                 | copied at time of add, immutable thereafter                      |
| `unit_price_snapshot` | decimal                | copied at time of add, immutable thereafter                      |
| `quantity`            | integer ≥ 1            | editable while bill is Open                                      |
| `line_total`          | decimal                | = `quantity × unit_price_snapshot`, always derived               |

**Critical rule:** Once a bill item is created, its `*_snapshot` fields must never change even if the underlying Menu Item is later edited, deactivated, or deleted. See Section 12 (Historical Data Protection).

---

## 3. Admin — Menu Management

- Admin can Add, Modify, and Deactivate/soft-delete menu items.
- `item_code` is system-generated, unique, and **never reused** for a different item even after deactivation.
- `price` must be a positive number (A11). No manual price entry is ever exposed to staff.
- `unit` is a free-text or predefined label (e.g. "Plate", "Piece"); displayed to staff and on all bills.
- `status`:
  - **Active** — selectable by staff for new bill items.
  - **Inactive** — hidden from staff's normal browse/search for new items, but **must still render correctly** in any historical bill that already references it (via the snapshot fields, not a live lookup).
- **Deletion behavior:** If an item has ever been used in any bill, "delete" must perform a soft delete (set to Inactive) rather than a hard delete. If an item has never been used in any bill, a hard delete is acceptable but not required.
- Editing an item's name/price/unit must **never** retroactively change any existing bill item snapshot or any finalized bill total.

---

## 4. Staff — Bill Creation & Active Bills

- **+ New Bill** button creates a new bill:
  - Staff enters `person_name` (required, free text).
  - System auto-generates a unique `bill_number` (continuous sequence, never reused — A7).
  - Bill status defaults to `Open`, payment status defaults to `Unpaid`.
- **Active Bills screen** lists all bills with status `Open`, showing at minimum: Bill Number, Person Name, Current Total, status label. Each row is clickable and opens that bill for editing.
- Staff can have any number of Open bills simultaneously and switch between them with no requirement to finish one before starting another.
- All Open bills are visible to all staff users (A2) — this is a shared pool, not a personal queue.

---

## 5. Staff — Meal Search & Selection

- **One single search field** — never separate Item Code / Item Name fields.
- Search rules:
  - Case-insensitive.
  - Partial-match capable.
  - Matches against both `item_code` and `item_name`.
  - Only `Active` items are returned in search/browse results for new selections.
- When the search field is empty, display the full list of Active menu items (Code, Name, Unit, Price).
- Selecting an item requires a quantity input:
  - Quantity must be a positive integer ≥ 1 (A8 — no fractional quantities in v1).
  - Reject blank, zero, or negative quantity.
  - Line total = `quantity × current menu price at time of selection`, captured immediately into the bill item snapshot.

### Duplicate item handling

If staff adds a menu item that is already present as a line on the same Open bill, **update the existing line's quantity** (add the new quantity to the existing one) rather than creating a second line for the same item. Exception: if the menu price for that item has changed since the existing line was added, do **not** merge — create a new separate line at the new price, leaving the original line's snapshot untouched (see Section 12).

---

## 6. Editing an Open Bill

While `status = Open`, staff may:

- Add items (per Section 5 rules).
- Change quantities on any line (must remain ≥ 1; to remove a line, use explicit removal, not quantity = 0).
- Remove items entirely, including the last remaining item (bill becomes an empty Open bill — A6).
- Edit the `person_name` (A5).
- View the live, auto-recalculated total at all times.

Staff must never be able to manually type or override the bill's `total_amount` — it is always derived from line totals.

---

## 7. Finalizing a Bill

Triggered by staff action **Finalize Bill** on an Open bill.

Preconditions:

- Bill must have at least one bill item (Section 8 — no zero-total finalized bills).

Flow:

1. Show confirmation dialog: total amount + "Once finalized, the bill can no longer be edited." Staff can confirm or cancel the dialog.
2. On confirm:
   - Recompute and lock `total_amount`.
   - Preserve all quantities and price snapshots exactly as they are.
   - Capture `finalized_at` (date + time) and `finalized_by` (A3).
   - Set `status = Finalized`.
   - Remove the bill from the Active Bills list.
   - Include the bill in revenue calculations from this point onward, keyed to the finalization date.
   - Display the final bill on screen (Section 9 format).
3. After finalization, the bill is read-only for normal staff operations (no quantity/item/total changes). There is no un-finalize/void flow in v1 (A9).

---

## 8. Cancelling a Bill

Triggered by staff action **Cancel Bill** on an Open bill.

Flow:

1. Show a confirmation dialog before cancelling, especially if the bill has items (A4) — mirror the finalize confirmation pattern.
2. On confirm:
   - Set `status = Cancelled`.
   - Capture `cancelled_at` and `cancelled_by` (A3).
   - Remove the bill from the Active Bills list.
   - Exclude permanently from revenue.
   - Retain the record historically (do not physically delete) for audit purposes.

A cancelled bill can never be re-opened, edited, or finalized in v1.

---

## 9. Final Bill Display

After finalization, render on screen (no PDF/print required):

```
BILL #<bill_number>
<person_name>
<finalized_date> <finalized_time>

Item        Qty   Unit    Unit Price   Amount
<name>      <qty> <unit>  <price>      <line_total>
...

TOTAL: <total_amount>
PAYMENT: <Paid|Unpaid>
```

---

## 10. Bill Status & Payment Status

**Bill Status** (mutually exclusive lifecycle): `Open` → `Finalized` **or** `Open` → `Cancelled`. No other transitions exist.

**Payment Status** (independent of Bill Status): `Unpaid` (default) or `Paid`. Either staff or admin may toggle this in either direction on a Finalized bill (A10). Payment status never affects revenue inclusion — a Finalized+Unpaid bill still counts toward revenue in full.

---

## 11. Revenue Calculation (Admin)

- **Daily Revenue** = sum of `total_amount` for all bills where `status = Finalized` **and** `finalized_at` falls on the selected date.
- Revenue is keyed by **finalization date**, not creation date. A bill created on one calendar day but finalized after midnight belongs to the finalization day's revenue.
- Open and Cancelled bills are always excluded from revenue, regardless of their total.
- Revenue must never be manually entered or edited — it is always a derived query over Finalized bills.

### Admin Daily Billing View must show:

- Total Revenue for the selected date.
- Total count of Finalized bills for the selected date.
- A table of all Finalized bills for that date: Bill No., Person, Time, Total, Payment status.
- Clicking a bill opens full historical bill detail (Section 9 format, using stored snapshots only — never re-derived from current menu data).

### Date filtering

At minimum: select a specific date. Ranges like "This week/month" are optional future enhancements — do not build them unless separately requested.

---

## 12. Historical Data Protection (non-negotiable)

- Bill Item snapshot fields (`item_code_snapshot`, `item_name_snapshot`, `unit_snapshot`, `unit_price_snapshot`) must be captured at the moment the item is added to a bill and must **never** change afterward, regardless of any later edits to the underlying Menu Item (price change, name change, deactivation, or soft-delete).
- Rendering any past bill (open, finalized, or cancelled) must use only the stored snapshot data on the bill/bill item — never a live join/lookup against the current Menu Item price or name.
- Deactivating or soft-deleting a Menu Item must not remove or blank out its appearance in any bill that already references it.

---

## 13. No Customer Management (explicit exclusion)

Do **not** build any of the following: customer profiles, customer accounts, customer IDs, customer purchase history, or automatic matching of person names across bills. `person_name` is a plain text field stored only on the Bill record. Two bills with the same person name are entirely unrelated records.

---

## 14. Staff Permissions

Staff can: create bills, edit person name (while Open), view/switch active bills, search/browse active menu, add/edit/remove bill items and quantities, view live totals, cancel Open bills (with confirmation), finalize Open bills (with confirmation), view final bill display, update payment status.

Staff cannot: manage menu items or prices, manually enter/override prices or totals, edit a Finalized or Cancelled bill's items/quantities/total, un-finalize a bill.

## 15. Admin Permissions

Admin can: add/modify/deactivate menu items, manage item codes/prices/units, view all finalized bills and their details, view daily revenue by date, view/update payment status, access historical billing data.

Admin cannot: manually enter or edit the revenue figure, alter historical bill item snapshots, reassign a previously-used item code to a different item.

---

## 16. Out of Scope for v1 (do not build)

Customer profiles/accounts/loyalty, table management, reservations, kitchen management, inventory management, tax/GST calculation, discounts, service charges, payment gateway/online payments, PDF receipt generation, printing, meal subscriptions/plans, automatic customer recognition, un-finalize/void workflow, fractional quantities, category management, multi-currency, date-range revenue filters beyond single-date selection, and any optimistic-locking/concurrency-conflict handling.

---

## 17. Business Rules Checklist (build-time verification)

Use this list to self-verify the implementation before considering the feature complete:

- [ ] Every bill has a unique, system-generated, sequential `bill_number`; never manually entered, never reused.
- [ ] Every menu item has a unique, system-generated `item_code`; never manually entered, never reused for a different item.
- [ ] Multiple Open bills can exist and be switched between with no forced sequential completion.
- [ ] One single search field covers both item code and item name; case-insensitive; partial match.
- [ ] Only `Active` menu items appear in search/browse for new selections; `Inactive` items are hidden from new selection but still render correctly in bills that already reference them.
- [ ] Staff never sees a price-entry field when adding items to a bill.
- [ ] Line Total = Quantity × Unit Price (snapshot); Bill Total = Sum of Line Totals; both always derived, never manually entered.
- [ ] Adding a duplicate item at the same price merges into the existing line's quantity; adding it after a price change creates a separate line without disturbing the earlier snapshot.
- [ ] Quantity accepts only whole numbers ≥ 1; blank/zero/negative rejected.
- [ ] A bill with zero items cannot be finalized.
- [ ] Finalize requires a confirmation dialog and, once confirmed, locks the bill (status, snapshots, timestamps, user) permanently.
- [ ] Cancel requires a confirmation dialog and, once confirmed, permanently excludes the bill from revenue while retaining it historically.
- [ ] Finalized and Cancelled bills are read-only; no un-finalize/reopen path exists.
- [ ] Payment status (`Unpaid`/`Paid`) is independent of bill status and never affects revenue.
- [ ] Daily revenue = sum of Finalized bill totals grouped by `finalized_at` date; Open and Cancelled bills always excluded regardless of total.
- [ ] Changing a menu item's price/name never alters any existing bill item snapshot or any already-finalized bill's total.
- [ ] `created_by`, `finalized_by`, `cancelled_by`, `payment_updated_by` are captured wherever applicable (A3).
- [ ] No customer/person record of any kind is created or reused across bills.
