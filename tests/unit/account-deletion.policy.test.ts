/**
 * Account deletion — the rules that decide whether someone disappears.
 *
 * This is the one policy where a wrong answer is unrecoverable: an erasure
 * cannot be undone, and a student who asked to leave and was not erased is a
 * promise broken to a regulator. So the cases below are deliberately about the
 * edges — who may ask, who may finish it, what a second tap does, and exactly
 * which fields survive.
 */
import { describe, expect, it } from "vitest";
import {
  DELETED_ROLL_PREFIX,
  DELETION_WINDOW_DAYS,
  DeletionRequestStatus,
  canTransitionDeletionRequest,
  completeDeletion,
  cancelDeletion,
  erasureDueDate,
  redactedIdentity,
  requestDeletion,
} from "@/core/policies/account-deletion.policy";
import { toServiceDate } from "@/core/time";
import { isErr, isOk, unwrap } from "@/core/result";

const today = toServiceDate("2026-09-21");

describe("who may ask to be deleted", () => {
  it("lets a student delete their own account", () => {
    const decision = requestDeletion({ actorRole: "STUDENT", openRequest: null, today });
    expect(isOk(decision)).toBe(true);
    expect(unwrap(decision).eraseBy).toBe("2026-10-21");
  });

  it("refuses an admin or staff member", () => {
    // Mess employees do not own their logins — the mess does. Letting an admin
    // erase themselves from a phone would orphan the hostel that depends on
    // them, and there would be nobody left to undo it.
    for (const actorRole of ["ADMIN", "STAFF", "SUPER_ADMIN"] as const) {
      const decision = requestDeletion({ actorRole, openRequest: null, today });
      expect(isErr(decision)).toBe(true);
      if (isErr(decision)) expect(decision.error.code).toBe("FORBIDDEN");
    }
  });

  it("treats a second tap as the same request, not a new one", () => {
    // The confirm button is on a phone at a mess counter. A double tap, a retry
    // over flaky wifi and a reinstall must all leave exactly one open request
    // (rule 5) — and the student must be told it worked, not shown an error.
    const open = { id: "req-1", status: DeletionRequestStatus.REQUESTED, eraseBy: "2026-10-01" };
    const decision = requestDeletion({ actorRole: "STUDENT", openRequest: open, today });
    expect(isOk(decision)).toBe(true);
    // The original deadline stands. A retry must not push erasure further away,
    // or a student could keep their data alive by tapping every day.
    expect(unwrap(decision).eraseBy).toBe("2026-10-01");
    expect(unwrap(decision).alreadyRequested).toBe(true);
  });
});

describe("the deadline", () => {
  it("is 30 days after the request", () => {
    expect(DELETION_WINDOW_DAYS).toBe(30);
    expect(erasureDueDate(today)).toBe("2026-10-21");
  });

  it("crosses a month and a year end without drifting", () => {
    expect(erasureDueDate(toServiceDate("2026-12-15"))).toBe("2027-01-14");
    // February, in a leap year, from the last day of January.
    expect(erasureDueDate(toServiceDate("2028-01-31"))).toBe("2028-03-01");
  });
});

describe("legal transitions", () => {
  it("allows a request to be completed or cancelled", () => {
    expect(canTransitionDeletionRequest("REQUESTED", "COMPLETED")).toBe(true);
    expect(canTransitionDeletionRequest("REQUESTED", "CANCELLED")).toBe(true);
  });

  it("makes completion terminal", () => {
    // Nothing follows erasure. There is no data left to act on, and a
    // "cancelled" completed request would imply the student is back.
    expect(canTransitionDeletionRequest("COMPLETED", "CANCELLED")).toBe(false);
    expect(canTransitionDeletionRequest("COMPLETED", "REQUESTED")).toBe(false);
  });

  it("does not let a cancelled request be completed behind the student's back", () => {
    expect(canTransitionDeletionRequest("CANCELLED", "COMPLETED")).toBe(false);
    expect(canTransitionDeletionRequest("CANCELLED", "REQUESTED")).toBe(false);
  });
});

describe("who may finish it", () => {
  it("lets an admin erase a requested account", () => {
    const decision = completeDeletion({ actorRole: "ADMIN", current: "REQUESTED" });
    expect(isOk(decision)).toBe(true);
  });

  it("refuses staff", () => {
    // Counter staff verify meals. Erasing a person is a different authority.
    const decision = completeDeletion({ actorRole: "STAFF", current: "REQUESTED" });
    expect(isErr(decision)).toBe(true);
    if (isErr(decision)) expect(decision.error.code).toBe("FORBIDDEN");
  });

  it("refuses to erase a student who never asked", () => {
    // Authorization first, so a permitted actor is the only one who learns the
    // state of the request.
    const decision = completeDeletion({ actorRole: "ADMIN", current: "CANCELLED" });
    expect(isErr(decision)).toBe(true);
    if (isErr(decision)) expect(decision.error.code).toBe("ILLEGAL_TRANSITION");
  });

  it("reports a second erasure as illegal rather than repeating it", () => {
    const decision = completeDeletion({ actorRole: "ADMIN", current: "COMPLETED" });
    expect(isErr(decision)).toBe(true);
    if (isErr(decision)) expect(decision.error.code).toBe("ILLEGAL_TRANSITION");
  });

  it("lets an admin cancel a request but never an erasure", () => {
    expect(isOk(cancelDeletion({ actorRole: "ADMIN", current: "REQUESTED" }))).toBe(true);
    const done = cancelDeletion({ actorRole: "ADMIN", current: "COMPLETED" });
    expect(isErr(done)).toBe(true);
    if (isErr(done)) expect(done.error.code).toBe("ILLEGAL_TRANSITION");
  });
});

describe("what erasure writes", () => {
  const studentId = "3f2a1b9c-1111-2222-3333-444455556666";

  it("removes every field the privacy policy promises to remove", () => {
    const redacted = redactedIdentity(studentId);
    expect(redacted.phone).toBeNull();
    expect(redacted.email).toBeNull();
    expect(redacted.photoUrl).toBeNull();
    expect(redacted.roomNumber).toBeNull();
    expect(redacted.block).toBeNull();
  });

  it("leaves a name that identifies nobody", () => {
    const redacted = redactedIdentity(studentId);
    expect(redacted.fullName).not.toContain(studentId);
    // `full_name` is NOT NULL with a non-blank constraint, so the row needs
    // some name; it must read as an absence to whoever opens the admin list.
    expect(redacted.fullName.trim().length).toBeGreaterThan(0);
  });

  it("replaces the roll number without colliding or going blank", () => {
    // `students_tenant_roll_key` is unique and the column is NOT NULL, so
    // erasure cannot simply clear it: two erased students in one mess would
    // collide and the write would fail on the second.
    const a = redactedIdentity(studentId);
    const b = redactedIdentity("99999999-1111-2222-3333-444455556666");
    expect(a.rollNumber).toMatch(new RegExp(`^${DELETED_ROLL_PREFIX}`));
    expect(a.rollNumber).not.toBe(b.rollNumber);
    expect(a.rollNumber.trim().length).toBeGreaterThan(0);
  });

  it("derives the same values every time, so a retried erasure writes nothing new", () => {
    expect(redactedIdentity(studentId)).toEqual(redactedIdentity(studentId));
  });

  it("keeps nothing that could be turned back into a person", () => {
    const redacted = redactedIdentity(studentId);
    const written = JSON.stringify(redacted).toLowerCase();
    for (const pii of ["9100000101", "qa student", "@demo-hostel"]) {
      expect(written).not.toContain(pii);
    }
  });
});
