/**
 * Tests for interpreting an uploaded student sheet.
 *
 * This runs once, against a live mess, on a file a non-technical person typed.
 * Nothing is written until every row passes, so this is the only thing standing
 * between a spreadsheet and several hundred real logins with real money
 * attached.
 *
 * The two fields that cause lasting damage if wrong are the roll number, which
 * a student logs in with, and the amount paid, which becomes an immutable
 * snapshot on the subscription. Both are guarded hardest.
 */
import { describe, expect, it } from "vitest";
import {
  previewStudentImport,
  IMPORT_COLUMNS,
  type ImportPlan,
  type ExistingStudent,
} from "@/core/policies/student-import.policy";

const PLANS: ImportPlan[] = [
  {
    id: "plan-1",
    name: "Monthly — Lunch & Dinner",
    durationDays: 90,
    pricePaise: 520000,
    mealSlots: ["LUNCH", "DINNER"],
  },
  {
    id: "plan-2",
    name: "Breakfast only",
    durationDays: 30,
    pricePaise: 90000,
    mealSlots: ["BREAKFAST"],
  },
];

const TODAY = "2026-08-15";

function preview(csvRows: string[][], existing: ExistingStudent[] = []) {
  return previewStudentImport({ rows: csvRows, plans: PLANS, existing, today: TODAY });
}

const HEADER = ["roll_number", "full_name"];

describe("previewStudentImport — the header", () => {
  it("accepts a file with just the two required columns", () => {
    const r = preview([HEADER, ["CS1", "Priya Menon"]]);
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(1);
  });

  it("rejects a file missing roll_number", () => {
    const r = preview([["full_name"], ["Priya"]]);
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.message).toMatch(/roll_number/);
  });

  it("rejects a file missing full_name", () => {
    const r = preview([["roll_number"], ["CS1"]]);
    expect(r.ok).toBe(false);
  });

  it("rejects an empty file", () => {
    expect(preview([]).ok).toBe(false);
  });

  it("rejects a file with only a header", () => {
    const r = preview([HEADER]);
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.message).toMatch(/no rows|empty/i);
  });

  it("matches headers regardless of case, spaces or punctuation", () => {
    // "Roll Number" is what somebody types when they build the sheet by hand.
    const r = preview([
      ["Roll Number", " FULL NAME "],
      ["CS1", "Priya"],
    ]);
    expect(r.ok).toBe(true);
  });

  it("ignores columns it does not know, so the office may keep its own notes", () => {
    const r = preview([
      [...HEADER, "paid_by", "remarks"],
      ["CS1", "Priya", "cash", "ok"],
    ]);
    expect(r.ok).toBe(true);
  });

  it("rejects a duplicated column rather than silently picking one", () => {
    const r = preview([
      ["roll_number", "full_name", "roll_number"],
      ["CS1", "P", "CS2"],
    ]);
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.message).toMatch(/twice|duplicate/i);
  });
});

describe("previewStudentImport — row numbers point at the spreadsheet", () => {
  it("calls the first data row 2, because row 1 is the header", () => {
    // An error saying "row 1" when the user must fix row 2 costs more time than
    // no message at all.
    const r = preview([HEADER, ["", "Priya"]]);
    expect(r.errors[0]!.rowNumber).toBe(2);
  });

  it("keeps counting through blank lines the parser dropped", () => {
    const r = preview([HEADER, ["CS1", "A"], ["CS2", "B"], ["", ""]]);
    expect(r.ok).toBe(true);
    expect(r.rows.map((x) => x.rowNumber)).toEqual([2, 3]);
  });
});

describe("previewStudentImport — required fields", () => {
  it("rejects a missing roll number", () => {
    const r = preview([HEADER, ["", "Priya"]]);
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.column).toBe("roll_number");
  });

  it("rejects a roll number that cannot form a login", () => {
    const r = preview([HEADER, ["CS 1/2", "Priya"]]);
    expect(r.ok).toBe(false);
  });

  it("rejects a missing name", () => {
    const r = preview([HEADER, ["CS1", ""]]);
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.column).toBe("full_name");
  });

  it("skips a wholly blank row instead of complaining about it", () => {
    // Spreadsheets are full of trailing empty rows.
    const r = preview([HEADER, ["CS1", "Priya"], ["", ""]]);
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(1);
  });
});

describe("previewStudentImport — duplicates", () => {
  it("rejects the same roll number twice in the file", () => {
    const r = preview([HEADER, ["CS1", "A"], ["CS1", "B"]]);
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.rowNumber).toBe(3);
    expect(r.errors[0]!.message).toMatch(/row 2/);
  });

  it("compares case-insensitively, like the database index", () => {
    const r = preview([HEADER, ["CS1", "A"], ["cs1", "B"]]);
    expect(r.ok).toBe(false);
  });

  it("treats a roll number that already exists as an UPDATE, not an error", () => {
    // Re-uploading a corrected sheet is expected, not exceptional.
    const r = preview([HEADER, ["CS1", "Priya Menon"]], [{ rollNumber: "cs1", studentId: "s-1" }]);
    expect(r.ok).toBe(true);
    expect(r.rows[0]!.action).toBe("UPDATE");
    expect(r.rows[0]!.studentId).toBe("s-1");
  });

  it("marks a genuinely new roll number as CREATE", () => {
    const r = preview([HEADER, ["CS2", "New Person"]], [{ rollNumber: "cs1", studentId: "s-1" }]);
    expect(r.rows[0]!.action).toBe("CREATE");
  });
});

describe("previewStudentImport — the plan", () => {
  const withPlan = (name: string, start = "2026-08-01") =>
    preview([
      [...HEADER, "plan_name", "plan_start_date"],
      ["CS1", "Priya", name, start],
    ]);

  it("resolves a plan by exact name", () => {
    const r = withPlan("Monthly — Lunch & Dinner");
    expect(r.ok).toBe(true);
    expect(r.rows[0]!.subscription?.planId).toBe("plan-1");
  });

  it("resolves it despite a hyphen typed for the em-dash", () => {
    // Nobody typing in Excel produces an em-dash, and the pilot tenant's only
    // plan has one in its name.
    expect(withPlan("Monthly - Lunch & Dinner").ok).toBe(true);
  });

  it("resolves it despite case and extra spacing", () => {
    expect(withPlan("  monthly —  lunch & dinner ").ok).toBe(true);
  });

  it("refuses an unknown plan rather than inventing one", () => {
    const r = withPlan("Gold Plan");
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.column).toBe("plan_name");
  });

  it("requires a start date whenever a plan is named", () => {
    const r = preview([
      [...HEADER, "plan_name"],
      ["CS1", "Priya", "Breakfast only"],
    ]);
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.column).toBe("plan_start_date");
  });

  it("creates no subscription when no plan is named", () => {
    const r = preview([HEADER, ["CS1", "Priya"]]);
    expect(r.ok).toBe(true);
    expect(r.rows[0]!.subscription).toBeUndefined();
  });

  it("derives the end date from the plan's duration, inclusive", () => {
    const r = withPlan("Breakfast only", "2026-08-01"); // 30 days
    expect(r.rows[0]!.subscription?.startDate).toBe("2026-08-01");
    expect(r.rows[0]!.subscription?.endDate).toBe("2026-08-30");
  });

  it("accepts an explicit end date that overrides the duration", () => {
    const r = preview([
      [...HEADER, "plan_name", "plan_start_date", "plan_end_date"],
      ["CS1", "Priya", "Breakfast only", "2026-08-01", "2026-09-15"],
    ]);
    expect(r.ok).toBe(true);
    expect(r.rows[0]!.subscription?.endDate).toBe("2026-09-15");
  });

  it("rejects an end date before the start", () => {
    const r = preview([
      [...HEADER, "plan_name", "plan_start_date", "plan_end_date"],
      ["CS1", "Priya", "Breakfast only", "2026-08-01", "2026-07-01"],
    ]);
    expect(r.ok).toBe(false);
  });

  it("rejects a start date whose plan has already ended", () => {
    const r = withPlan("Breakfast only", "2026-01-01");
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.message).toMatch(/ended/i);
  });
});

describe("previewStudentImport — money", () => {
  const withAmount = (amount: string) =>
    preview([
      [...HEADER, "plan_name", "plan_start_date", "amount_paid_inr"],
      ["CS1", "Priya", "Breakfast only", "2026-08-01", amount],
    ]);

  it("uses the plan's list price when the column is blank", () => {
    expect(withAmount("").rows[0]!.subscription?.pricePaise).toBe(90000);
  });

  it("converts whole rupees to paise", () => {
    expect(withAmount("800").rows[0]!.subscription?.pricePaise).toBe(80000);
  });

  it("converts paise correctly, without floating-point drift", () => {
    // 5200.55 * 100 in floating point is 520054.99999999994. Rounding wrong
    // here understates a payment by a paisa, permanently, on an immutable row.
    expect(withAmount("5200.55").rows[0]!.subscription?.pricePaise).toBe(520055);
    expect(withAmount("0.07").rows[0]!.subscription?.pricePaise).toBe(7);
    expect(withAmount("1.10").rows[0]!.subscription?.pricePaise).toBe(110);
  });

  it("accepts Indian digit grouping, which is how it will be typed", () => {
    expect(withAmount("5,200").rows[0]!.subscription?.pricePaise).toBe(520000);
    expect(withAmount("1,02,400").rows[0]!.subscription?.pricePaise).toBe(10240000);
  });

  it("accepts a rupee symbol or prefix", () => {
    expect(withAmount("₹5200").rows[0]!.subscription?.pricePaise).toBe(520000);
    expect(withAmount("Rs. 5200").rows[0]!.subscription?.pricePaise).toBe(520000);
  });

  it("rejects more than two decimals rather than rounding somebody's money", () => {
    expect(withAmount("5200.555").ok).toBe(false);
  });

  it("rejects a negative amount", () => {
    expect(withAmount("-100").ok).toBe(false);
  });

  it("rejects text", () => {
    expect(withAmount("paid").ok).toBe(false);
  });

  it("accepts zero — a waived or sponsored plan is legitimate", () => {
    expect(withAmount("0").rows[0]!.subscription?.pricePaise).toBe(0);
  });
});

describe("previewStudentImport — subscription status", () => {
  const withStatus = (amount: string, status = "") =>
    preview([
      [...HEADER, "plan_name", "plan_start_date", "amount_paid_inr", "subscription_status"],
      ["CS1", "Priya", "Breakfast only", "2026-08-01", amount, status],
    ]);

  it("defaults to ACTIVE when an amount was paid", () => {
    expect(withStatus("900").rows[0]!.subscription?.status).toBe("ACTIVE");
  });

  it("defaults to PENDING_PAYMENT when nothing was paid", () => {
    expect(withStatus("").rows[0]!.subscription?.status).toBe("PENDING_PAYMENT");
  });

  it("honours an explicit status", () => {
    expect(withStatus("900", "PENDING_PAYMENT").rows[0]!.subscription?.status).toBe(
      "PENDING_PAYMENT",
    );
  });

  it("rejects a status the database has no value for", () => {
    expect(withStatus("900", "PAID").ok).toBe(false);
  });
});

describe("previewStudentImport — re-importing must not double-charge", () => {
  const row = () =>
    preview(
      [
        [...HEADER, "plan_name", "plan_start_date"],
        ["CS1", "Priya", "Breakfast only", "2026-08-01"],
      ],
      [
        {
          rollNumber: "cs1",
          studentId: "s-1",
          activeSubscription: { startDate: "2026-08-01", endDate: "2026-08-30" },
        },
      ],
    );

  it("skips a subscription that already covers exactly this period", () => {
    const r = row();
    expect(r.ok).toBe(true);
    expect(r.rows[0]!.subscription).toBeUndefined();
    expect(r.rows[0]!.warnings.join(" ")).toMatch(/already/i);
  });

  it("still updates the student's details on that row", () => {
    expect(row().rows[0]!.action).toBe("UPDATE");
  });

  it("refuses to silently replace a DIFFERENT active subscription", () => {
    // Changing what somebody paid for is a decision with an audit entry, not a
    // side effect of re-uploading a spreadsheet.
    const r = preview(
      [
        [...HEADER, "plan_name", "plan_start_date"],
        ["CS1", "Priya", "Breakfast only", "2026-08-05"],
      ],
      [
        {
          rollNumber: "cs1",
          studentId: "s-1",
          activeSubscription: { startDate: "2026-08-01", endDate: "2026-08-30" },
        },
      ],
    );
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.message).toMatch(/already has|different/i);
  });
});

describe("previewStudentImport — optional student fields", () => {
  it("carries room, phone and email through", () => {
    const r = preview([
      [...HEADER, "phone", "email", "block", "room_number"],
      ["CS1", "Priya", "9876543210", "p@example.com", "A", "104"],
    ]);
    expect(r.ok).toBe(true);
    expect(r.rows[0]!.student.phone).toBe("9876543210");
    expect(r.rows[0]!.student.block).toBe("A");
  });

  it("rejects a malformed phone", () => {
    expect(
      preview([
        [...HEADER, "phone"],
        ["CS1", "P", "12"],
      ]).ok,
    ).toBe(false);
  });

  it("rejects an unknown student status", () => {
    expect(
      preview([
        [...HEADER, "status"],
        ["CS1", "P", "SUSPENDED"],
      ]).ok,
    ).toBe(false);
  });

  it("accepts a known student status", () => {
    const r = preview([
      [...HEADER, "status"],
      ["CS1", "P", "blocked"],
    ]);
    expect(r.ok).toBe(true);
    expect(r.rows[0]!.student.status).toBe("BLOCKED");
  });

  it("rejects a joined_at that is not a date", () => {
    expect(
      preview([
        [...HEADER, "joined_at"],
        ["CS1", "P", "01/08/2026"],
      ]).ok,
    ).toBe(false);
  });
});

describe("previewStudentImport — the summary the admin confirms against", () => {
  it("counts creates, updates and money", () => {
    const r = preview(
      [
        [...HEADER, "plan_name", "plan_start_date", "amount_paid_inr"],
        ["CS1", "A", "Breakfast only", "2026-08-01", "900"],
        ["CS2", "B", "Breakfast only", "2026-08-01", "900"],
        ["CS3", "C", "", "", ""],
      ],
      [{ rollNumber: "cs1", studentId: "s-1" }],
    );
    expect(r.ok).toBe(true);
    expect(r.summary.create).toBe(2);
    expect(r.summary.update).toBe(1);
    expect(r.summary.subscriptions).toBe(2);
    expect(r.summary.totalPaise).toBe(180000);
  });

  it("reports every bad row at once, not just the first", () => {
    const r = preview([HEADER, ["", "A"], ["CS2", ""], ["CS 3", "C"]]);
    expect(r.errors).toHaveLength(3);
    expect(r.errors.map((e) => e.rowNumber)).toEqual([2, 3, 4]);
  });

  it("keeps no rows at all when anything failed", () => {
    // Nothing is written unless everything validates.
    const r = preview([HEADER, ["CS1", "A"], ["", "B"]]);
    expect(r.ok).toBe(false);
    expect(r.rows).toHaveLength(0);
  });
});

/**
 * The export must be re-importable.
 *
 * "Export, bulk-edit rooms in Excel, re-import" is how a start-of-term
 * reshuffle will actually be done, and it only works if the two formats cannot
 * drift. Both read `IMPORT_COLUMNS`, and this asserts the contract rather than
 * trusting that they still do.
 */
describe("IMPORT_COLUMNS — the export and import share one definition", () => {
  it("includes both required columns", () => {
    expect(IMPORT_COLUMNS).toContain("roll_number");
    expect(IMPORT_COLUMNS).toContain("full_name");
  });

  it("is accepted as a header by the importer", () => {
    // The exact row the export writes first.
    const r = preview([
      [...IMPORT_COLUMNS],
      ["CS1", "Priya Menon", "", "", "", "", "", "", "", "", "", "", "", ""],
    ]);
    expect(r.ok).toBe(true);
  });

  it("round-trips a fully-populated exported row", () => {
    const exported = [
      [...IMPORT_COLUMNS],
      [
        "CS1",
        "Priya Menon",
        "9876543210",
        "p@example.com",
        "A",
        "104",
        "2026-08-01",
        "ACTIVE",
        "Breakfast only",
        "2026-08-01",
        "2026-08-30",
        "900.00",
        "",
        "ACTIVE",
      ],
    ];
    const r = preview(exported);
    expect(r.ok).toBe(true);
    expect(r.rows[0]!.student.rollNumber).toBe("CS1");
    expect(r.rows[0]!.student.block).toBe("A");
    // 900.00 rupees is exactly 90000 paise — the export writes two decimals and
    // the import must not lose the trailing zeros.
    expect(r.rows[0]!.subscription?.pricePaise).toBe(90000);
    expect(r.rows[0]!.subscription?.endDate).toBe("2026-08-30");
  });

  it("has no duplicate column names, which would make the header ambiguous", () => {
    expect(new Set(IMPORT_COLUMNS).size).toBe(IMPORT_COLUMNS.length);
  });
});
