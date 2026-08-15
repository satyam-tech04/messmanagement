/**
 * Tests for deciding an away request.
 *
 * The decision itself is one line of business, but the guards around it are
 * where a mess loses money or trust:
 *
 *   * a rejection with no reason gives the student nothing to act on, and the
 *     database refuses it anyway (`mess_cuts_rejection_has_reason`)
 *   * deciding a request twice would move a row out of a state the ledger will
 *     later depend on
 *   * approving a period that is entirely in the past cannot save a single
 *     plate — the food was cooked while the request sat unreviewed
 */
import { describe, expect, it } from "vitest";
import { UserRole } from "@/core/domain/enums";
import { decideAbsence, type AbsenceDecision } from "@/core/policies/decide-absence.policy";
import { toServiceDate } from "@/core/time";

const today = toServiceDate("2026-08-15");

function decision(over: Partial<AbsenceDecision> = {}): AbsenceDecision {
  return {
    actorRole: UserRole.ADMIN,
    currentStatus: "PENDING",
    outcome: "APPROVED",
    reason: "",
    dateFrom: toServiceDate("2026-08-20"),
    dateTo: toServiceDate("2026-08-25"),
    today,
    ...over,
  };
}

describe("decideAbsence — who may decide", () => {
  it("allows an admin", () => {
    expect(decideAbsence(decision()).ok).toBe(true);
  });

  it("allows a super admin", () => {
    expect(decideAbsence(decision({ actorRole: UserRole.SUPER_ADMIN })).ok).toBe(true);
  });

  it("refuses staff — verifying attendance does not imply granting absences", () => {
    const r = decideAbsence(decision({ actorRole: UserRole.STAFF }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });

  it("refuses a student approving their own request", () => {
    const r = decideAbsence(decision({ actorRole: UserRole.STUDENT }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });

  it("checks authorization before anything else", () => {
    // An unauthorized actor must not learn from the error whether the request
    // was already decided.
    const r = decideAbsence(decision({ actorRole: UserRole.STUDENT, currentStatus: "APPROVED" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });
});

describe("decideAbsence — only a pending request can be decided", () => {
  it("refuses one that is already approved", () => {
    const r = decideAbsence(decision({ currentStatus: "APPROVED" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("ILLEGAL_TRANSITION");
  });

  it("refuses one the student has withdrawn", () => {
    // The student changed their plans. Approving it afterwards would mark them
    // absent from meals they intend to eat.
    const r = decideAbsence(decision({ currentStatus: "CANCELLED" }));
    expect(r.ok).toBe(false);
  });

  it("refuses one that was already rejected", () => {
    const r = decideAbsence(decision({ currentStatus: "REJECTED" }));
    expect(r.ok).toBe(false);
  });

  it("refuses one that has been credited — money is attached to it", () => {
    const r = decideAbsence(decision({ currentStatus: "CREDITED" }));
    expect(r.ok).toBe(false);
  });
});

describe("decideAbsence — a rejection must say why", () => {
  it("requires a reason", () => {
    const r = decideAbsence(decision({ outcome: "REJECTED", reason: "" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a whitespace-only reason", () => {
    const r = decideAbsence(decision({ outcome: "REJECTED", reason: "   \n " }));
    expect(r.ok).toBe(false);
  });

  it("accepts a real reason and trims it", () => {
    const r = decideAbsence(decision({ outcome: "REJECTED", reason: "  Too late notice  " }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.reason).toBe("Too late notice");
  });

  it("does not require a reason to approve", () => {
    expect(decideAbsence(decision({ outcome: "APPROVED", reason: "" })).ok).toBe(true);
  });

  it("stores no reason on an approval, even if one was typed", () => {
    // `rejection_reason` on an approved row would read as a rejection to
    // anyone scanning the table later.
    const r = decideAbsence(decision({ outcome: "APPROVED", reason: "fine by me" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.reason).toBeNull();
  });
});

describe("decideAbsence — a period that has already passed", () => {
  it("refuses to approve one that ended before today", () => {
    // The food was cooked while the request sat unreviewed. Approving now
    // removes nothing from any headcount; it only manufactures a credit.
    const r = decideAbsence(
      decision({
        dateFrom: toServiceDate("2026-08-01"),
        dateTo: toServiceDate("2026-08-10"),
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION_FAILED");
  });

  it("allows approving one that started but has not finished", () => {
    // Partly late is the mess's own delay, and the remaining days are still
    // worth saving. Penalising the student for the office's slowness is wrong.
    const r = decideAbsence(
      decision({
        dateFrom: toServiceDate("2026-08-12"),
        dateTo: toServiceDate("2026-08-20"),
      }),
    );
    expect(r.ok).toBe(true);
  });

  it("allows approving one that ends today", () => {
    const r = decideAbsence(decision({ dateFrom: toServiceDate("2026-08-10"), dateTo: today }));
    expect(r.ok).toBe(true);
  });

  it("still allows REJECTING a period that has passed", () => {
    // The student is owed an answer either way, and a stale pending row is
    // worse than a decided one.
    const r = decideAbsence(
      decision({
        outcome: "REJECTED",
        reason: "Notice arrived after the meal",
        dateFrom: toServiceDate("2026-08-01"),
        dateTo: toServiceDate("2026-08-10"),
      }),
    );
    expect(r.ok).toBe(true);
  });
});

describe("decideAbsence — what it returns", () => {
  it("returns the status to write", () => {
    const r = decideAbsence(decision({ outcome: "APPROVED" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe("APPROVED");
  });

  it("returns REJECTED with the reason attached", () => {
    const r = decideAbsence(decision({ outcome: "REJECTED", reason: "Exam week" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe("REJECTED");
      expect(r.value.reason).toBe("Exam week");
    }
  });

  it("returns the transition, so the audit entry cannot be written wrong", () => {
    const r = decideAbsence(decision({ outcome: "REJECTED", reason: "Too short a notice" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.from).toBe("PENDING");
      expect(r.value.to).toBe("REJECTED");
    }
  });
});
