/**
 * Tests for validating a batch of students before any of them is created.
 *
 * Creating a student is not one write — it is a Supabase Auth user, a profile,
 * a student row and possibly a subscription, and the auth call cannot take part
 * in a Postgres transaction. So a batch that fails halfway leaves real accounts
 * behind that cannot be rolled back cleanly.
 *
 * The defence is to make failure at write time almost impossible: every row is
 * checked against every rule, and against the rows beside it, before the first
 * account exists. The case that only a batch can produce — the same roll number
 * typed twice in one form — is the one a per-row check would never catch, and
 * it would fail at the database's unique index *after* an auth user had already
 * been created for it.
 */
import { describe, expect, it } from "vitest";
import {
  validateStudentBatch,
  MAX_BATCH_SIZE,
  type StudentDraft,
} from "@/core/policies/student-batch.policy";

function row(over: Partial<StudentDraft> = {}): StudentDraft {
  return { rollNumber: "CS22B101", fullName: "Priya Menon", ...over };
}

describe("validateStudentBatch — blank rows are not errors", () => {
  it("ignores a row where nothing was typed", () => {
    // The form shows ten rows; an admin filling six must not be told off about
    // the other four.
    const r = validateStudentBatch([row(), { rollNumber: "", fullName: "" }], []);
    expect(r.errors).toEqual([]);
    expect(r.valid).toHaveLength(1);
  });

  it("ignores a row containing only whitespace", () => {
    const r = validateStudentBatch([row(), { rollNumber: "   ", fullName: "  " }], []);
    expect(r.errors).toEqual([]);
    expect(r.valid).toHaveLength(1);
  });

  it("rejects a batch that is entirely blank rather than reporting success", () => {
    // Submitting an empty form must say so, not quietly do nothing and look
    // like it worked.
    const r = validateStudentBatch([{ rollNumber: "", fullName: "" }], []);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.valid).toHaveLength(0);
  });

  it("rejects an empty list", () => {
    expect(validateStudentBatch([], []).errors.length).toBeGreaterThan(0);
  });
});

describe("validateStudentBatch — a half-filled row is a mistake, not a blank", () => {
  it("rejects a row with a roll number but no name", () => {
    const r = validateStudentBatch([{ rollNumber: "CS22B101", fullName: "" }], []);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.field).toBe("fullName");
    expect(r.errors[0]!.index).toBe(0);
  });

  it("rejects a row with a name but no roll number", () => {
    // Without a roll number they cannot log in at all, so this must never be
    // silently dropped as if the row were blank.
    const r = validateStudentBatch([{ rollNumber: "", fullName: "Priya Menon" }], []);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.field).toBe("rollNumber");
  });
});

describe("validateStudentBatch — roll number rules", () => {
  it("rejects characters that cannot form a login", () => {
    // The synthetic login email is derived from the roll number, so anything
    // unsafe in an email local-part cannot be stored.
    const r = validateStudentBatch([row({ rollNumber: "CS 22/B101" })], []);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.field).toBe("rollNumber");
  });

  it("accepts dots, underscores and hyphens", () => {
    expect(validateStudentBatch([row({ rollNumber: "cs-22.b_101" })], []).errors).toEqual([]);
  });

  it("trims surrounding whitespace rather than rejecting it", () => {
    // Pasting a column out of Excel brings spaces with it.
    const r = validateStudentBatch([row({ rollNumber: "  CS22B101  " })], []);
    expect(r.errors).toEqual([]);
    expect(r.valid[0]!.rollNumber).toBe("CS22B101");
  });

  it("trims the name too", () => {
    const r = validateStudentBatch([row({ fullName: "  Priya Menon  " })], []);
    expect(r.valid[0]!.fullName).toBe("Priya Menon");
  });
});

describe("validateStudentBatch — duplicates inside the same batch", () => {
  it("catches the same roll number typed twice", () => {
    // The case only a batch can produce. Left to the database it would fail on
    // the unique index AFTER an auth user had been created for the second row.
    const r = validateStudentBatch(
      [row({ rollNumber: "CS22B101" }), row({ rollNumber: "CS22B101" })],
      [],
    );
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.index).toBe(1);
    expect(r.errors[0]!.field).toBe("rollNumber");
  });

  it("catches it regardless of case, matching the database's index", () => {
    // `students_tenant_roll_key` is on lower(roll_number).
    const r = validateStudentBatch(
      [row({ rollNumber: "CS22B101" }), row({ rollNumber: "cs22b101" })],
      [],
    );
    expect(r.errors).toHaveLength(1);
  });

  it("blames the second occurrence, not the first", () => {
    // The first row is fine; it is the repeat the admin has to change.
    const r = validateStudentBatch(
      [row({ rollNumber: "AAA" }), row({ rollNumber: "BBB" }), row({ rollNumber: "AAA" })],
      [],
    );
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.index).toBe(2);
  });

  it("reports a triple as two errors, so fixing one still shows the other", () => {
    const r = validateStudentBatch(
      [row({ rollNumber: "AAA" }), row({ rollNumber: "AAA" }), row({ rollNumber: "AAA" })],
      [],
    );
    expect(r.errors.map((e) => e.index)).toEqual([1, 2]);
  });

  it("keeps no valid rows when a duplicate is present", () => {
    // Nothing is written while any row is wrong, so a partially-created batch
    // cannot exist.
    const r = validateStudentBatch([row({ rollNumber: "AAA" }), row({ rollNumber: "AAA" })], []);
    expect(r.ok).toBe(false);
  });
});

describe("validateStudentBatch — duplicates against students already enrolled", () => {
  it("rejects a roll number that already exists", () => {
    const r = validateStudentBatch([row({ rollNumber: "CS21B003" })], ["cs21b003"]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.field).toBe("rollNumber");
    expect(r.errors[0]!.message).toMatch(/already/i);
  });

  it("matches case-insensitively", () => {
    expect(
      validateStudentBatch([row({ rollNumber: "cs21b003" })], ["CS21B003"]).errors,
    ).toHaveLength(1);
  });

  it("allows a roll number that merely resembles an existing one", () => {
    expect(validateStudentBatch([row({ rollNumber: "CS21B0033" })], ["cs21b003"]).errors).toEqual(
      [],
    );
  });
});

describe("validateStudentBatch — batch size", () => {
  it("accepts a full batch", () => {
    const rows = Array.from({ length: MAX_BATCH_SIZE }, (_, i) => row({ rollNumber: `CS${i}` }));
    expect(validateStudentBatch(rows, []).errors).toEqual([]);
  });

  it("refuses more than the cap", () => {
    // Each student costs one Supabase Auth call, and a serverless request has a
    // hard time limit. Past the cap the CSV import is the right tool, and
    // saying so beats a request that dies halfway with accounts half-created.
    const rows = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) =>
      row({ rollNumber: `CS${i}` }),
    );
    const r = validateStudentBatch(rows, []);
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.message).toMatch(/at once|import/i);
  });

  it("counts only filled rows against the cap", () => {
    // Trailing blank rows in the form must not consume the allowance.
    const rows = [
      ...Array.from({ length: MAX_BATCH_SIZE }, (_, i) => row({ rollNumber: `CS${i}` })),
      { rollNumber: "", fullName: "" },
      { rollNumber: "", fullName: "" },
    ];
    expect(validateStudentBatch(rows, []).ok).toBe(true);
  });
});

describe("validateStudentBatch — optional fields", () => {
  it("accepts a row with only the two required fields", () => {
    expect(validateStudentBatch([{ rollNumber: "CS1", fullName: "A B" }], []).errors).toEqual([]);
  });

  it("rejects a malformed phone number", () => {
    const r = validateStudentBatch([row({ phone: "12" })], []);
    expect(r.errors[0]!.field).toBe("phone");
  });

  it("accepts a phone with a country code", () => {
    expect(validateStudentBatch([row({ phone: "+919876543210" })], []).errors).toEqual([]);
  });

  it("rejects a malformed email", () => {
    const r = validateStudentBatch([row({ email: "not-an-email" })], []);
    expect(r.errors[0]!.field).toBe("email");
  });

  it("carries room details through", () => {
    const r = validateStudentBatch([row({ block: "A", roomNumber: "104" })], []);
    expect(r.valid[0]!.block).toBe("A");
    expect(r.valid[0]!.roomNumber).toBe("104");
  });
});

describe("validateStudentBatch — every error is reported at once", () => {
  it("does not stop at the first bad row", () => {
    // An admin fixing ten rows one round trip at a time would give up. Report
    // everything wrong in one pass.
    const r = validateStudentBatch(
      [
        row({ rollNumber: "bad name" }),
        row({ rollNumber: "CS2", fullName: "" }),
        row({ rollNumber: "CS3", phone: "x" }),
      ],
      [],
    );
    expect(r.errors).toHaveLength(3);
    expect(r.errors.map((e) => e.index)).toEqual([0, 1, 2]);
  });

  it("reports ok only when nothing is wrong", () => {
    expect(validateStudentBatch([row()], []).ok).toBe(true);
    expect(validateStudentBatch([row({ fullName: "" })], []).ok).toBe(false);
  });
});
