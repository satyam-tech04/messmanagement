/**
 * Counter sales — the walk-in billing pad ("à la carte").
 *
 * A standalone cash register by decision (D-16): a bill records a person's
 * *name* and nothing else. There is no customer record, and two bills bearing
 * the same name are unrelated. A subscriber buying an extra sweet pays for it
 * here in cash; it never reaches their mess account.
 *
 * The rules that carry real weight, and why:
 *
 *   **Snapshots.** A line copies the item's code, name, unit and price when it
 *   is added. Renaming or repricing the item afterwards must never move a bill
 *   that already exists — least of all a finalized one, which is somebody's
 *   receipt.
 *
 *   **The merge exception.** Adding the same item twice bumps the existing
 *   line's quantity, *unless* the price has changed since that line was added.
 *   Then it becomes a second line at the new price, because merging would
 *   silently reprice what the customer was already quoted.
 *
 *   **One-way status.** OPEN → FINALIZED or OPEN → CANCELLED, nothing else.
 *   There is no un-finalize in v1, so finalize is the point of no return and is
 *   guarded accordingly.
 */
import { describe, expect, it } from "vitest";
import {
  billTotalPaise,
  canCancelBill,
  canEditBill,
  canFinalizeBill,
  canTogglePayment,
  lineTotalPaise,
  matchesItemSearch,
  parseCounterItemDraft,
  parsePersonName,
  parseQuantity,
  planLineAddition,
  type BillLine,
  type BillSnapshot,
} from "@/core/policies/counter-sales.policy";
import { toPaise } from "@/core/money";

const rupees = (n: number) => toPaise(n * 100);

function line(over: Partial<BillLine> = {}): BillLine {
  return {
    id: "line-1",
    counterItemId: "item-1",
    itemCodeSnapshot: "C001",
    itemNameSnapshot: "Masala Dosa",
    unitSnapshot: "Plate",
    unitPricePaise: rupees(60),
    quantity: 1,
    ...over,
  };
}

function bill(over: Partial<BillSnapshot> = {}): BillSnapshot {
  return { status: "OPEN", paymentStatus: "UNPAID", ...over };
}

// ---------------------------------------------------------------------------
// Totals — always derived, never typed (spec §6)
// ---------------------------------------------------------------------------

describe("totals", () => {
  it("multiplies quantity by the snapshot price, not the current one", () => {
    expect(lineTotalPaise(line({ quantity: 3, unitPricePaise: rupees(60) }))).toBe(rupees(180));
  });

  it("sums the lines", () => {
    const total = billTotalPaise([
      line({ id: "a", quantity: 2, unitPricePaise: rupees(60) }),
      line({ id: "b", quantity: 1, unitPricePaise: rupees(25) }),
    ]);
    expect(total).toBe(rupees(145));
  });

  it("is zero for an empty bill rather than throwing", () => {
    // An empty open bill is legal — staff may remove the last line (A6). It
    // simply cannot be finalized, which is a separate rule.
    expect(billTotalPaise([])).toBe(0);
  });

  it("stays exact across many lines", () => {
    // Thirty ₹33.33 plates must total ₹999.90 exactly. In rupee floats this
    // drifts; in paise it cannot.
    const lines = Array.from({ length: 30 }, (_, i) =>
      line({ id: `l${i}`, quantity: 1, unitPricePaise: toPaise(3333) }),
    );
    expect(billTotalPaise(lines)).toBe(toPaise(99990));
  });
});

// ---------------------------------------------------------------------------
// Quantity (spec §5, A8)
// ---------------------------------------------------------------------------

describe("parseQuantity", () => {
  it("accepts a positive whole number", () => {
    const r = parseQuantity(3);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(3);
  });

  it("rejects zero — removing a line is an explicit action, not a quantity", () => {
    expect(parseQuantity(0).ok).toBe(false);
  });

  it("rejects negative and fractional quantities (A8)", () => {
    expect(parseQuantity(-1).ok).toBe(false);
    expect(parseQuantity(1.5).ok).toBe(false);
  });

  it("rejects a quantity nobody could have meant", () => {
    expect(parseQuantity(100_000).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Adding an item — the merge rule and its exception (spec §5)
// ---------------------------------------------------------------------------

describe("planLineAddition", () => {
  it("starts a new line when the item is not on the bill", () => {
    const r = planLineAddition({
      lines: [],
      counterItemId: "item-1",
      currentPricePaise: rupees(60),
      quantity: 2,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ kind: "NEW_LINE", quantity: 2 });
  });

  it("adds to the existing line when the price is unchanged", () => {
    const r = planLineAddition({
      lines: [line({ id: "l1", quantity: 2, unitPricePaise: rupees(60) })],
      counterItemId: "item-1",
      currentPricePaise: rupees(60),
      quantity: 3,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ kind: "MERGE", lineId: "l1", newQuantity: 5 });
  });

  it("starts a separate line when the price has changed since (spec §5)", () => {
    // The customer was quoted ₹60 for the first plate. Merging at ₹70 would
    // silently reprice it; a second line keeps both prices honest.
    const r = planLineAddition({
      lines: [line({ id: "l1", quantity: 1, unitPricePaise: rupees(60) })],
      counterItemId: "item-1",
      currentPricePaise: rupees(70),
      quantity: 1,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ kind: "NEW_LINE", quantity: 1 });
  });

  it("merges into the line matching today's price when several exist", () => {
    // After a price change there can be a ₹60 line and a ₹70 line for the same
    // item. A third plate at ₹70 belongs on the ₹70 line.
    const r = planLineAddition({
      lines: [
        line({ id: "old", quantity: 1, unitPricePaise: rupees(60) }),
        line({ id: "new", quantity: 1, unitPricePaise: rupees(70) }),
      ],
      counterItemId: "item-1",
      currentPricePaise: rupees(70),
      quantity: 1,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ kind: "MERGE", lineId: "new", newQuantity: 2 });
  });

  it("ignores lines for a different item", () => {
    const r = planLineAddition({
      lines: [line({ id: "l1", counterItemId: "other", unitPricePaise: rupees(60) })],
      counterItemId: "item-1",
      currentPricePaise: rupees(60),
      quantity: 1,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.kind).toBe("NEW_LINE");
  });

  it("rejects a bad quantity before deciding anything", () => {
    const r = planLineAddition({
      lines: [],
      counterItemId: "item-1",
      currentPricePaise: rupees(60),
      quantity: 0,
    });
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The state machine (spec §10)
// ---------------------------------------------------------------------------

describe("bill status", () => {
  it("allows editing only while open", () => {
    expect(canEditBill(bill({ status: "OPEN" }))).toBe(true);
    expect(canEditBill(bill({ status: "FINALIZED" }))).toBe(false);
    expect(canEditBill(bill({ status: "CANCELLED" }))).toBe(false);
  });

  it("finalizes an open bill that has at least one line", () => {
    expect(canFinalizeBill(bill(), [line()]).ok).toBe(true);
  });

  it("refuses to finalize an empty bill (spec §7)", () => {
    // A zero-total finalized bill would sit in the day's revenue as a row that
    // means nothing and cannot be explained.
    const r = canFinalizeBill(bill(), []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION_FAILED");
  });

  it("refuses to finalize twice — there is no un-finalize in v1 (A9)", () => {
    const r = canFinalizeBill(bill({ status: "FINALIZED" }), [line()]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("ILLEGAL_TRANSITION");
  });

  it("refuses to finalize a cancelled bill", () => {
    expect(canFinalizeBill(bill({ status: "CANCELLED" }), [line()]).ok).toBe(false);
  });

  it("cancels an open bill, empty or not", () => {
    expect(canCancelBill(bill()).ok).toBe(true);
  });

  it("refuses to cancel a finalized bill", () => {
    // Finalized is the receipt. Undoing it is a refund, which v1 does not do.
    const r = canCancelBill(bill({ status: "FINALIZED" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("ILLEGAL_TRANSITION");
  });

  it("refuses to cancel twice", () => {
    expect(canCancelBill(bill({ status: "CANCELLED" })).ok).toBe(false);
  });
});

describe("payment status", () => {
  it("toggles in both directions on a finalized bill (A10)", () => {
    expect(canTogglePayment(bill({ status: "FINALIZED", paymentStatus: "UNPAID" })).ok).toBe(true);
    expect(canTogglePayment(bill({ status: "FINALIZED", paymentStatus: "PAID" })).ok).toBe(true);
  });

  it("refuses on an open bill — nothing has been billed yet", () => {
    expect(canTogglePayment(bill({ status: "OPEN" })).ok).toBe(false);
  });

  it("refuses on a cancelled bill", () => {
    expect(canTogglePayment(bill({ status: "CANCELLED" })).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Search (spec §5) and the catalogue (spec §3)
// ---------------------------------------------------------------------------

describe("matchesItemSearch", () => {
  const item = { itemCode: "C012", itemName: "Masala Dosa" };

  it("matches a partial name, case-insensitively", () => {
    expect(matchesItemSearch(item, "dosa")).toBe(true);
    expect(matchesItemSearch(item, "MASALA")).toBe(true);
  });

  it("matches the item code too — one field, both meanings", () => {
    expect(matchesItemSearch(item, "c012")).toBe(true);
    expect(matchesItemSearch(item, "012")).toBe(true);
  });

  it("returns everything for an empty or blank query (spec §5)", () => {
    expect(matchesItemSearch(item, "")).toBe(true);
    expect(matchesItemSearch(item, "   ")).toBe(true);
  });

  it("does not match unrelated text", () => {
    expect(matchesItemSearch(item, "idli")).toBe(false);
  });
});

describe("parseCounterItemDraft", () => {
  const base = {
    actorRole: "ADMIN" as const,
    itemName: "Masala Dosa",
    priceRupees: 60,
    unit: "Plate",
  };

  it("accepts a valid item", () => {
    const r = parseCounterItemDraft(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.pricePaise).toBe(6000);
  });

  it("rejects a zero or negative price (A11)", () => {
    expect(parseCounterItemDraft({ ...base, priceRupees: 0 }).ok).toBe(false);
    expect(parseCounterItemDraft({ ...base, priceRupees: -5 }).ok).toBe(false);
  });

  it("rejects a blank name", () => {
    expect(parseCounterItemDraft({ ...base, itemName: "  " }).ok).toBe(false);
  });

  it("rejects a blank unit — it prints on every bill", () => {
    expect(parseCounterItemDraft({ ...base, unit: " " }).ok).toBe(false);
  });

  it("trims what it stores", () => {
    const r = parseCounterItemDraft({ ...base, itemName: "  Idli  ", unit: " Piece " });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.itemName).toBe("Idli");
      expect(r.value.unit).toBe("Piece");
    }
  });

  it("refuses staff — only an admin prices the catalogue (spec §14)", () => {
    const r = parseCounterItemDraft({ ...base, actorRole: "STAFF" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });
});

describe("parsePersonName", () => {
  it("accepts a plain name", () => {
    const r = parsePersonName("Ramesh");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("Ramesh");
  });

  it("rejects blank — every bill has to be identifiable at the counter", () => {
    expect(parsePersonName("   ").ok).toBe(false);
  });

  it("rejects something absurdly long", () => {
    expect(parsePersonName("x".repeat(200)).ok).toBe(false);
  });
});
