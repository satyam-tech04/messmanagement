/**
 * Importing a mess's weekly menu from a spreadsheet.
 *
 * The document a mess actually hands you is one table holding two different
 * things: a weekly rotation of dishes, and a short list of separately-priced
 * extras — tea, chapati, a plate of rice. The first is a menu; the second is
 * the counter-sales catalogue. This policy tells them apart and rejects
 * anything it cannot place, rather than guessing.
 *
 * The Price column against each day's meal is deliberately ignored (D-25). It
 * describes what a walk-in would pay for that day's food, which nothing in the
 * system charges for yet, and inventing a home for it would have been the
 * implementer choosing a business rule.
 */
import { describe, expect, it } from "vitest";
import {
  expandWeeklyMenu,
  parseMenuImport,
  type MenuImportRequest,
} from "@/core/policies/menu-import.policy";
import { toServiceDate } from "@/core/time";

const SERVED = ["BREAKFAST", "LUNCH", "SNACKS", "DINNER"] as const;

function request(over: Partial<MenuImportRequest> = {}): MenuImportRequest {
  return {
    rows: [],
    servedSlots: SERVED,
    ...over,
  };
}

// The shape a mess's own spreadsheet exports, header included.
const HEADER = ["Day", "Meal", "Menu Items", "Price (₹)"];

describe("parseMenuImport — the weekly rotation", () => {
  it("reads a day, a meal and a comma-separated list of dishes", () => {
    const result = parseMenuImport(
      request({
        rows: [HEADER, ["Monday", "Lunch", "Chana Masala, Aloo Flower, Dal, Rice", "90"]],
      }),
    );
    expect(result.errors).toEqual([]);
    expect(result.menu).toHaveLength(1);
    expect(result.menu[0]).toEqual({
      weekday: 1,
      mealSlot: "LUNCH",
      items: ["Chana Masala", "Aloo Flower", "Dal", "Rice"],
    });
  });

  it("ignores the price column entirely (D-25)", () => {
    const result = parseMenuImport(
      request({ rows: [HEADER, ["Monday", "Lunch", "Dal, Rice", "90"]] }),
    );
    expect(result.menu[0]).not.toHaveProperty("pricePaise");
  });

  it("is case-insensitive about days and meals", () => {
    const result = parseMenuImport(
      request({ rows: [HEADER, ["  sUNDAY ", "  dinner", "Matar Paneer", ""]] }),
    );
    expect(result.errors).toEqual([]);
    expect(result.menu[0]?.weekday).toBe(0);
    expect(result.menu[0]?.mealSlot).toBe("DINNER");
  });

  it("trims each dish and drops empty ones", () => {
    // Trailing commas and double spaces are what a spreadsheet actually
    // produces; they must not become blank menu entries a student sees.
    const result = parseMenuImport(
      request({ rows: [HEADER, ["Monday", "Lunch", " Dal ,, Rice ,", "90"]] }),
    );
    expect(result.menu[0]?.items).toEqual(["Dal", "Rice"]);
  });

  it("rejects a weekday it does not recognise", () => {
    const result = parseMenuImport(request({ rows: [HEADER, ["Funday", "Lunch", "Dal", "90"]] }));
    expect(result.menu).toHaveLength(0);
    expect(result.errors[0]?.column).toBe("Day");
    expect(result.errors[0]?.rowNumber).toBe(2);
  });

  it("rejects a meal the mess does not serve", () => {
    // Publishing a menu for a meal with no window promises food at a counter
    // that never opens.
    const result = parseMenuImport(
      request({
        rows: [HEADER, ["Monday", "Snacks", "Vada Pav", "20"]],
        servedSlots: ["LUNCH", "DINNER"],
      }),
    );
    expect(result.menu).toHaveLength(0);
    expect(result.errors[0]?.message).toContain("snacks");
  });

  it("rejects a day-meal row with no dishes", () => {
    const result = parseMenuImport(request({ rows: [HEADER, ["Monday", "Lunch", "   ", "90"]] }));
    expect(result.errors[0]?.column).toBe("Menu Items");
  });

  it("refuses the same day and meal twice", () => {
    // Two Monday lunches means whichever row lands last silently wins.
    const result = parseMenuImport(
      request({
        rows: [
          HEADER,
          ["Monday", "Lunch", "Dal, Rice", "90"],
          ["Monday", "Lunch", "Something else", "90"],
        ],
      }),
    );
    expect(result.menu).toHaveLength(1);
    expect(result.errors[0]?.rowNumber).toBe(3);
    expect(result.errors[0]?.message).toContain("already");
  });
});

describe("parseMenuImport — the extras block", () => {
  it("reads a row with no day or meal as a counter item", () => {
    const result = parseMenuImport(request({ rows: [HEADER, ["", "", "Tea", "10"]] }));
    expect(result.errors).toEqual([]);
    expect(result.counterItems).toEqual([{ itemName: "Tea", pricePaise: 1000, unit: "Each" }]);
  });

  it("keeps money in integer paise", () => {
    const result = parseMenuImport(request({ rows: [HEADER, ["", "", "Coffee", "15.50"]] }));
    expect(result.counterItems[0]?.pricePaise).toBe(1550);
  });

  it("strips a rupee sign and separators the spreadsheet added", () => {
    const result = parseMenuImport(request({ rows: [HEADER, ["", "", "Thali", "₹1,250"]] }));
    expect(result.counterItems[0]?.pricePaise).toBe(125000);
  });

  it("skips a section heading like 'Extras', which has a name but no price", () => {
    // The real sheet has one. It is a label, not something you can sell.
    // Paired with a real item so the sheet is not empty overall — an empty
    // sheet is its own error, tested separately.
    const result = parseMenuImport(
      request({ rows: [HEADER, ["", "", "Extras", ""], ["", "", "Chapati", "10"]] }),
    );
    expect(result.counterItems.map((i) => i.itemName)).toEqual(["Chapati"]);
    expect(result.errors).toEqual([]);
  });

  it("skips the blank separator rows a spreadsheet leaves behind", () => {
    const result = parseMenuImport(
      request({
        rows: [HEADER, ["", "", "", ""], ["  ", "", "  ", "  "], ["", "", "Tea", "10"]],
      }),
    );
    expect(result.counterItems).toHaveLength(1);
    expect(result.menu).toHaveLength(0);
    expect(result.errors).toEqual([]);
  });

  it("rejects a zero or negative price rather than creating a free item", () => {
    const zero = parseMenuImport(request({ rows: [HEADER, ["", "", "Tea", "0"]] }));
    expect(zero.errors[0]?.column).toBe("Price");
    const negative = parseMenuImport(request({ rows: [HEADER, ["", "", "Tea", "-5"]] }));
    expect(negative.errors).toHaveLength(1);
  });

  it("refuses the same item twice", () => {
    const result = parseMenuImport(
      request({ rows: [HEADER, ["", "", "Tea", "10"], ["", "", "tea", "12"]] }),
    );
    expect(result.counterItems).toHaveLength(1);
    expect(result.errors[0]?.message).toContain("already");
  });
});

describe("parseMenuImport — the whole sheet", () => {
  it("separates the two kinds of row from one table", () => {
    const result = parseMenuImport(
      request({
        rows: [
          HEADER,
          ["Monday", "Breakfast", "Sabudana Khichdi", "40"],
          ["Monday", "Lunch", "Chana Masala, Dal, Rice", "90"],
          ["", "", "", ""],
          ["", "", "Tea", "10"],
          ["", "", "Extras", ""],
          ["", "", "Chapati", "10"],
        ],
      }),
    );
    expect(result.errors).toEqual([]);
    expect(result.menu).toHaveLength(2);
    expect(result.counterItems.map((i) => i.itemName)).toEqual(["Tea", "Chapati"]);
  });

  it("reports an empty sheet rather than importing nothing silently", () => {
    const result = parseMenuImport(request({ rows: [HEADER] }));
    expect(result.errors[0]?.message).toContain("nothing");
  });

  it("carries on after a bad row so the admin sees every problem at once", () => {
    const result = parseMenuImport(
      request({
        rows: [
          HEADER,
          ["Funday", "Lunch", "Dal", "90"],
          ["Monday", "Lunch", "Dal, Rice", "90"],
          ["", "", "Tea", "nonsense"],
        ],
      }),
    );
    expect(result.menu).toHaveLength(1);
    expect(result.errors).toHaveLength(2);
    expect(result.errors.map((e) => e.rowNumber)).toEqual([2, 4]);
  });
});

// ---------------------------------------------------------------------------
// Expanding one week across a month
// ---------------------------------------------------------------------------

describe("expandWeeklyMenu", () => {
  const monday = { weekday: 1 as const, mealSlot: "LUNCH" as const, items: ["Dal", "Rice"] };
  const sunday = { weekday: 0 as const, mealSlot: "LUNCH" as const, items: ["Veg Biryani"] };

  it("lands each weekday's menu on every matching date in the range", () => {
    // 7–20 Sep 2026 contains two Mondays: the 7th and the 14th.
    const days = expandWeeklyMenu(
      [monday],
      toServiceDate("2026-09-07"),
      toServiceDate("2026-09-20"),
    );
    expect(days.map((d) => d.serviceDate)).toEqual([
      toServiceDate("2026-09-07"),
      toServiceDate("2026-09-14"),
    ]);
  });

  it("gets the weekday right for Sunday, which is 0 and easy to be off by one on", () => {
    const days = expandWeeklyMenu(
      [sunday],
      toServiceDate("2026-09-07"),
      toServiceDate("2026-09-14"),
    );
    expect(days.map((d) => d.serviceDate)).toEqual([toServiceDate("2026-09-13")]);
  });

  it("includes both ends of the range", () => {
    const days = expandWeeklyMenu(
      [monday],
      toServiceDate("2026-09-07"),
      toServiceDate("2026-09-07"),
    );
    expect(days).toHaveLength(1);
  });

  it("carries the dishes onto every generated day", () => {
    const days = expandWeeklyMenu(
      [monday],
      toServiceDate("2026-09-07"),
      toServiceDate("2026-09-14"),
    );
    expect(days.every((d) => d.items.join() === "Dal,Rice")).toBe(true);
    expect(days.every((d) => d.mealSlot === "LUNCH")).toBe(true);
  });

  it("returns nothing when the range contains no matching weekday", () => {
    // Tue 8 Sep to Sat 12 Sep has no Monday in it.
    const days = expandWeeklyMenu(
      [monday],
      toServiceDate("2026-09-08"),
      toServiceDate("2026-09-12"),
    );
    expect(days).toEqual([]);
  });

  it("expands a full week over a month into 28 rows a week", () => {
    const week = SERVED.flatMap((slot) =>
      ([0, 1, 2, 3, 4, 5, 6] as const).map((weekday) => ({
        weekday,
        mealSlot: slot,
        items: ["x"],
      })),
    );
    const days = expandWeeklyMenu(week, toServiceDate("2026-09-01"), toServiceDate("2026-09-28"));
    expect(days).toHaveLength(4 * 7 * 4);
  });

  it("returns nothing when the range runs backwards", () => {
    const days = expandWeeklyMenu(
      [monday],
      toServiceDate("2026-09-20"),
      toServiceDate("2026-09-07"),
    );
    expect(days).toEqual([]);
  });
});
