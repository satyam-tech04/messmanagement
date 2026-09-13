/**
 * Counter sales — the walk-in billing pad.
 *
 * A cash register for people who are not on a meal plan, or who are and want
 * something extra. By decision **D-16** it is deliberately standalone: a bill
 * carries a person's *name* as free text and nothing else. There is no customer
 * record, no history across visits, and no link to a student — two bills with
 * the same name are unrelated rows.
 *
 * ## Why "counter sales" and not "billing"
 *
 * The admin sidebar already has a **Billing** entry, greyed out and badged
 * Phase 2, reserved for subscription invoices and Razorpay. Two screens called
 * Billing showing unrelated totals is how an owner ends up unable to say what
 * the mess earned. Likewise the catalogue here is `counter_items`, not "menu
 * items": `menus` already means the daily published menu, and plans separately
 * carry included meal slots.
 *
 * ## The two rules that carry weight
 *
 * **Snapshots.** A line copies the item's code, name, unit and price at the
 * moment it is added, and those copies never change. Repricing samosas
 * tomorrow must not alter a receipt printed today.
 *
 * **The merge exception.** Adding an item already on the bill bumps that line's
 * quantity — unless the price has moved since, in which case it becomes a
 * second line at the new price. Merging across a price change would silently
 * reprice what the customer was already quoted.
 */
import type { UserRole } from "@/core/domain/enums";
import { domainError, forbidden, illegalTransition, type DomainError } from "@/core/errors";
import { rupeesToPaise, toPaise, type Paise } from "@/core/money";
import { err, ok, type Result } from "@/core/result";

/** More plates than any counter serves one person; past this it is a typo. */
const MAX_QUANTITY = 999;
const MAX_PERSON_NAME = 120;
const MAX_ITEM_NAME = 120;
const MAX_UNIT = 24;
/** ₹1,00,000 for one item. Guards a mistyped extra zero. */
const MAX_ITEM_PRICE_PAISE = 100_000_00;

function isAdmin(role: UserRole): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type BillStatus = "OPEN" | "FINALIZED" | "CANCELLED";
export type PaymentStatus = "UNPAID" | "PAID";

export interface BillSnapshot {
  readonly status: BillStatus;
  readonly paymentStatus: PaymentStatus;
}

/**
 * One line of a bill.
 *
 * Every `*Snapshot` field is a copy taken when the line was created. Rendering
 * a bill uses only these — never a live lookup against the catalogue, which may
 * since have been repriced, renamed or deactivated.
 */
export interface BillLine {
  readonly id: string;
  /** Traceability only. Never used to recompute a historical value. */
  readonly counterItemId: string;
  readonly itemCodeSnapshot: string;
  readonly itemNameSnapshot: string;
  readonly unitSnapshot: string;
  readonly unitPricePaise: Paise;
  readonly quantity: number;
}

// ---------------------------------------------------------------------------
// Totals — derived, never entered (spec §6)
// ---------------------------------------------------------------------------

export function lineTotalPaise(line: BillLine): Paise {
  return toPaise(line.unitPricePaise * line.quantity);
}

export function billTotalPaise(lines: readonly BillLine[]): Paise {
  // Integer paise throughout: thirty plates at ₹33.33 must total ₹999.90
  // exactly, and floating point would not guarantee that.
  return toPaise(lines.reduce((sum, line) => sum + line.unitPricePaise * line.quantity, 0));
}

// ---------------------------------------------------------------------------
// Quantity (spec §5, A8 — whole numbers only in v1)
// ---------------------------------------------------------------------------

export function parseQuantity(value: number): Result<number, DomainError> {
  if (!Number.isInteger(value)) {
    return err(domainError("VALIDATION_FAILED", "Enter a whole number."));
  }
  if (value < 1) {
    // Zero is not a quantity, it is a removal — and removal is a separate,
    // deliberate action so nobody clears a line by fumbling the number pad.
    return err(
      domainError("VALIDATION_FAILED", "Enter at least 1. To take it off, remove the line."),
    );
  }
  if (value > MAX_QUANTITY) {
    return err(
      domainError("VALIDATION_FAILED", `That is more than ${MAX_QUANTITY} — check the number.`),
    );
  }
  return ok(value);
}

// ---------------------------------------------------------------------------
// Adding an item (spec §5)
// ---------------------------------------------------------------------------

export type LineAddition =
  | { readonly kind: "MERGE"; readonly lineId: string; readonly newQuantity: number }
  | { readonly kind: "NEW_LINE"; readonly quantity: number };

export interface LineAdditionInput {
  readonly lines: readonly BillLine[];
  readonly counterItemId: string;
  /** The catalogue price right now, which becomes the snapshot on a new line. */
  readonly currentPricePaise: Paise;
  readonly quantity: number;
}

export function planLineAddition(input: LineAdditionInput): Result<LineAddition, DomainError> {
  const quantity = parseQuantity(input.quantity);
  if (!quantity.ok) return quantity;

  // Matched on price as well as item. After a price change a bill may carry a
  // ₹60 line and a ₹70 line for the same item; another at ₹70 belongs on the
  // ₹70 line, and the ₹60 line stays exactly as the customer was quoted it.
  const existing = input.lines.find(
    (line) =>
      line.counterItemId === input.counterItemId && line.unitPricePaise === input.currentPricePaise,
  );

  if (!existing) return ok({ kind: "NEW_LINE", quantity: quantity.value });

  const merged = parseQuantity(existing.quantity + quantity.value);
  if (!merged.ok) return merged;

  return ok({ kind: "MERGE", lineId: existing.id, newQuantity: merged.value });
}

// ---------------------------------------------------------------------------
// The state machine (spec §10)
//
//   OPEN -> FINALIZED   or   OPEN -> CANCELLED
//
// and nothing else. There is no un-finalize or void in v1 (A9), which is
// exactly why finalize is guarded rather than merely validated.
// ---------------------------------------------------------------------------

export function canEditBill(bill: BillSnapshot): boolean {
  return bill.status === "OPEN";
}

export function canFinalizeBill(
  bill: BillSnapshot,
  lines: readonly BillLine[],
): Result<Paise, DomainError> {
  if (bill.status !== "OPEN") {
    return err(illegalTransition("Bill", bill.status, "FINALIZED"));
  }
  if (lines.length === 0) {
    // A zero-total finalized bill would sit in the day's revenue as a row that
    // means nothing and that nobody can explain a week later.
    return err(domainError("VALIDATION_FAILED", "Add at least one item before finalising."));
  }
  return ok(billTotalPaise(lines));
}

/**
 * The payment status a bill finalises with (D-29).
 *
 * Staff choose Paid or Unpaid in the finalise dialog, defaulting to Paid, since
 * at a cash counter the money usually changes hands as the bill is closed. The
 * spec originally finalised every bill as Unpaid and left the change to a later
 * toggle only the admin screen offered.
 *
 * No choice at all means Unpaid. App builds released before this change send
 * nothing, and recording those as paid would claim money the mess never
 * confirmed receiving (rule 7: fail closed on money).
 */
export function finalizePaymentStatus(
  raw: string | null | undefined,
): Result<PaymentStatus, DomainError> {
  if (raw === null || raw === undefined || raw === "") return ok("UNPAID");
  if (raw === "PAID" || raw === "UNPAID") return ok(raw);
  return err(domainError("VALIDATION_FAILED", "Choose whether the bill was paid."));
}

export function canCancelBill(bill: BillSnapshot): Result<void, DomainError> {
  if (bill.status !== "OPEN") {
    // Finalized is somebody's receipt. Undoing it is a refund, and v1 does not
    // do refunds.
    return err(illegalTransition("Bill", bill.status, "CANCELLED"));
  }
  return ok(undefined);
}

/**
 * Payment is independent of status but not of it entirely: only a finalized
 * bill has a total to be paid. An open bill is still being built, and a
 * cancelled one was never owed.
 *
 * Payment never affects revenue — a finalized unpaid bill counts in full
 * (spec §10).
 */
export function canTogglePayment(bill: BillSnapshot): Result<PaymentStatus, DomainError> {
  if (bill.status !== "FINALIZED") {
    return err(
      domainError("VALIDATION_FAILED", "Only a finalised bill can be marked paid or unpaid."),
    );
  }
  return ok(bill.paymentStatus === "PAID" ? "UNPAID" : "PAID");
}

// ---------------------------------------------------------------------------
// Search (spec §5) — one field, both meanings
// ---------------------------------------------------------------------------

export interface SearchableItem {
  readonly itemCode: string;
  readonly itemName: string;
}

/**
 * Case-insensitive partial match across code and name.
 *
 * One field, deliberately: staff at a counter with a queue behind them should
 * not have to decide which box a query belongs in. A blank query matches
 * everything, which is how the full catalogue renders by default.
 */
export function matchesItemSearch(item: SearchableItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return (
    item.itemCode.toLowerCase().includes(needle) || item.itemName.toLowerCase().includes(needle)
  );
}

// ---------------------------------------------------------------------------
// The catalogue (spec §3)
// ---------------------------------------------------------------------------

export interface CounterItemInput {
  readonly actorRole: UserRole;
  readonly itemName: string;
  readonly priceRupees: number;
  readonly unit: string;
}

export interface CounterItemDraft {
  readonly itemName: string;
  readonly pricePaise: Paise;
  readonly unit: string;
}

export function parseCounterItemDraft(
  input: CounterItemInput,
): Result<CounterItemDraft, DomainError> {
  // Staff never see a price field anywhere in this feature (spec §14). Pricing
  // is the admin's, and the counter only ever picks from what they set.
  if (!isAdmin(input.actorRole)) {
    return err(forbidden("Only an admin can manage counter items."));
  }

  const itemName = input.itemName.trim();
  if (itemName.length === 0) {
    return err(domainError("VALIDATION_FAILED", "Give the item a name."));
  }
  if (itemName.length > MAX_ITEM_NAME) {
    return err(domainError("VALIDATION_FAILED", "That name is too long."));
  }

  const unit = input.unit.trim();
  if (unit.length === 0) {
    // The unit prints on every bill line. "2 Masala Dosa" is ambiguous in a way
    // "2 Plate Masala Dosa" is not.
    return err(domainError("VALIDATION_FAILED", "Give the item a unit, such as Plate or Cup."));
  }
  if (unit.length > MAX_UNIT) {
    return err(domainError("VALIDATION_FAILED", "That unit is too long."));
  }

  if (!Number.isFinite(input.priceRupees)) {
    return err(domainError("VALIDATION_FAILED", "Enter a valid price."));
  }
  const exact = input.priceRupees * 100;
  if (Math.abs(exact - Math.round(exact)) > 1e-6) {
    return err(domainError("VALIDATION_FAILED", "A price cannot be finer than one paise."));
  }

  let pricePaise: Paise;
  try {
    pricePaise = rupeesToPaise(input.priceRupees);
  } catch {
    return err(domainError("VALIDATION_FAILED", "That price is too large."));
  }

  // A11: zero is rejected, not treated as free. A free item on a cash register
  // is almost always a price nobody filled in.
  if (pricePaise <= 0) {
    return err(domainError("VALIDATION_FAILED", "The price must be more than zero."));
  }
  if (pricePaise > MAX_ITEM_PRICE_PAISE) {
    return err(domainError("VALIDATION_FAILED", "That price looks too high — check the amount."));
  }

  return ok({ itemName, pricePaise, unit });
}

// ---------------------------------------------------------------------------
// The person on the bill (spec §4, §13)
// ---------------------------------------------------------------------------

/**
 * Free text, and nothing more (D-16, spec §13).
 *
 * Not validated against students, not matched across bills, not stored as a
 * record. It exists so staff can tell two open bills apart while both people
 * are standing there.
 */
export function parsePersonName(value: string): Result<string, DomainError> {
  const name = value.trim();
  if (name.length === 0) {
    return err(domainError("VALIDATION_FAILED", "Enter a name so you can tell the bills apart."));
  }
  if (name.length > MAX_PERSON_NAME) {
    return err(domainError("VALIDATION_FAILED", "That name is too long."));
  }
  return ok(name);
}
