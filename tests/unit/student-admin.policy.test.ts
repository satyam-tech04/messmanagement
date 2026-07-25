/**
 * Tests for the student administration policy.
 *
 * Written before the implementation. Each case names a concrete way an admin
 * screen could get this wrong and what it would cost the hostel.
 */
import { describe, expect, it } from "vitest";
import { StudentStatus, UserRole } from "@/core/domain/enums";
import {
  changeStudentStatus,
  subscriptionPeriodFor,
  type StatusChangeRequest,
} from "@/core/policies/student-admin.policy";
import { toServiceDate } from "@/core/time";

const base: StatusChangeRequest = {
  actorRole: UserRole.ADMIN,
  current: StudentStatus.ACTIVE,
  next: StudentStatus.INACTIVE,
  reason: "Left the hostel",
};

describe("changeStudentStatus — authorization", () => {
  it("allows an admin", () => {
    const r = changeStudentStatus(base);
    expect(r.ok).toBe(true);
  });

  it("allows a super admin", () => {
    const r = changeStudentStatus({ ...base, actorRole: UserRole.SUPER_ADMIN });
    expect(r.ok).toBe(true);
  });

  it("refuses staff — verifying attendance must not imply changing who gets fed", () => {
    const r = changeStudentStatus({ ...base, actorRole: UserRole.STAFF });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });

  it("refuses a student outright", () => {
    const r = changeStudentStatus({ ...base, actorRole: UserRole.STUDENT });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });

  it("checks authorization before the transition, so an unauthorized actor learns nothing", () => {
    // An illegal transition AND an unauthorized actor: the error must be
    // FORBIDDEN, not ILLEGAL_TRANSITION, or staff could probe the state machine.
    const r = changeStudentStatus({
      ...base,
      actorRole: UserRole.STAFF,
      current: StudentStatus.INACTIVE,
      next: StudentStatus.BLOCKED,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });
});

describe("changeStudentStatus — legal transitions (§2.6)", () => {
  it("permits ACTIVE → INACTIVE (a student leaving)", () => {
    const r = changeStudentStatus({ ...base, current: "ACTIVE", next: "INACTIVE" });
    expect(r.ok).toBe(true);
  });

  it("permits INACTIVE → ACTIVE (re-admission)", () => {
    const r = changeStudentStatus({ ...base, current: "INACTIVE", next: "ACTIVE" });
    expect(r.ok).toBe(true);
  });

  it("refuses INACTIVE → BLOCKED — you cannot block someone who already left", () => {
    const r = changeStudentStatus({ ...base, current: "INACTIVE", next: "BLOCKED" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("ILLEGAL_TRANSITION");
      expect(r.error.details).toMatchObject({ from: "INACTIVE", to: "BLOCKED" });
    }
  });

  it("refuses BLOCKED → GRACE — grace is granted before blocking, never after", () => {
    const r = changeStudentStatus({ ...base, current: "BLOCKED", next: "GRACE" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("ILLEGAL_TRANSITION");
  });

  it("treats a no-op change as a rejected no-op, not a silent success", () => {
    // The UI must not write an audit entry claiming a change that did not happen.
    const r = changeStudentStatus({ ...base, current: "ACTIVE", next: "ACTIVE" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION_FAILED");
  });
});

describe("changeStudentStatus — the reason is mandatory", () => {
  it("requires a reason, because the audit entry is the answer in a dispute", () => {
    const r = changeStudentStatus({ ...base, reason: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a whitespace-only reason", () => {
    const r = changeStudentStatus({ ...base, reason: "   \n  " });
    expect(r.ok).toBe(false);
  });

  it("trims the reason it returns", () => {
    const r = changeStudentStatus({ ...base, reason: "  Fees cleared  " });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.reason).toBe("Fees cleared");
  });

  it("returns from and to so the caller writes an audit entry it cannot get wrong", () => {
    const r = changeStudentStatus({ ...base, current: "GRACE", next: "BLOCKED" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.from).toBe("GRACE");
      expect(r.value.to).toBe("BLOCKED");
    }
  });
});

describe("subscriptionPeriodFor — dates derive in the tenant's timezone (rule 9)", () => {
  it("uses the tenant-local day, not UTC", () => {
    // 30 Jul 2026 20:00 UTC is already 31 Jul in Kolkata (UTC+5:30).
    // toISOString().slice(0,10) would yield 2026-07-30 and start the plan a day
    // early — the exact bug shipped twice in this repo.
    const period = subscriptionPeriodFor({
      timeZone: "Asia/Kolkata",
      now: new Date("2026-07-30T20:00:00Z"),
      durationDays: 30,
    });
    expect(period.startDate).toBe("2026-07-31");
  });

  it("still lands on the previous day for a tenant genuinely behind UTC", () => {
    const period = subscriptionPeriodFor({
      timeZone: "America/New_York",
      now: new Date("2026-07-31T02:00:00Z"), // 30 Jul 22:00 in New York
      durationDays: 30,
    });
    expect(period.startDate).toBe("2026-07-30");
  });

  it("makes the period inclusive: a 30-day plan started on the 1st ends on the 30th", () => {
    const period = subscriptionPeriodFor({
      timeZone: "Asia/Kolkata",
      now: new Date("2026-07-01T06:00:00Z"),
      durationDays: 30,
    });
    expect(period.startDate).toBe("2026-07-01");
    expect(period.endDate).toBe("2026-07-30");
  });

  it("spans a month boundary correctly", () => {
    const period = subscriptionPeriodFor({
      timeZone: "Asia/Kolkata",
      now: new Date("2026-07-20T06:00:00Z"),
      durationDays: 30,
    });
    expect(period.endDate).toBe("2026-08-18");
  });

  it("handles a 1-day plan — start and end are the same day", () => {
    const period = subscriptionPeriodFor({
      timeZone: "Asia/Kolkata",
      now: new Date("2026-07-20T06:00:00Z"),
      durationDays: 1,
    });
    expect(period.startDate).toBe("2026-07-20");
    expect(period.endDate).toBe("2026-07-20");
  });

  it("rejects a non-positive duration rather than producing an end before the start", () => {
    expect(() =>
      subscriptionPeriodFor({
        timeZone: "Asia/Kolkata",
        now: new Date("2026-07-20T06:00:00Z"),
        durationDays: 0,
      }),
    ).toThrow();
  });

  it("accepts an explicit start date, for backdating an activation", () => {
    const period = subscriptionPeriodFor({
      timeZone: "Asia/Kolkata",
      now: new Date("2026-07-20T06:00:00Z"),
      durationDays: 30,
      startDate: toServiceDate("2026-07-01"),
    });
    expect(period.startDate).toBe("2026-07-01");
    expect(period.endDate).toBe("2026-07-30");
  });
});
