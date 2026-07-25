import { describe, it, expect, beforeEach } from "vitest";
import {
  verifyManualAttendance,
  verifyQrAttendance,
  type VerifyAttendanceDeps,
} from "@/core/services/verify-attendance";
import { issueToken } from "@/core/policies/qr.policy";
import type { TenantContext, TenantSettings } from "@/core/domain/tenant-context";
import type { StudentForVerification } from "@/core/ports/repositories";
import { toWallClockTime, toServiceDate } from "@/core/time";
import { isErr, isOk, unwrap } from "@/core/result";
import {
  FakeAttendanceRepository,
  FakeAuditLogRepository,
  FakeMessCutRepository,
  FakeStudentRepository,
  FakeTenantRepository,
  fakeSigner,
} from "../fakes";

const IST = "Asia/Kolkata";
const TENANT = "11111111-1111-1111-1111-111111111111";
const OTHER_TENANT = "22222222-2222-2222-2222-222222222222";
const STUDENT = "33333333-3333-3333-3333-333333333333";
const SECRET = "tenant-signing-secret-at-least-32-characters";

// 13:00 IST on 15 July 2026 — inside the lunch window.
const DURING_LUNCH = new Date("2026-07-15T07:30:00Z");

const settings: TenantSettings = {
  tenantId: TENANT,
  mealSlots: [
    { slot: "LUNCH", start: toWallClockTime("12:00"), end: toWallClockTime("14:30") },
    { slot: "DINNER", start: toWallClockTime("19:30"), end: toWallClockTime("22:00") },
  ],
  cutAdvanceHours: 12,
  cutMaxDaysPerMonth: 5,
  gracePeriodDays: 3,
  blockOnOverdue: true,
  allowExtras: false,
  guestTokenPricePaise: 0,
  extraPlatePricePaise: 0,
  qrTokenTtlSeconds: 30,
  qrRefreshSeconds: 15,
  currency: "INR",
};

const staffCtx: TenantContext = {
  tenantId: TENANT,
  tenantSlug: "demo-hostel",
  timezone: IST,
  actorProfileId: "staff-profile-1",
  role: "STAFF",
};

const student = (over: Partial<StudentForVerification> = {}): StudentForVerification => ({
  studentId: STUDENT,
  tenantId: TENANT,
  rollNumber: "CS21B001",
  fullName: "Aarav Sharma",
  photoUrl: "https://example.test/photo.jpg",
  status: "ACTIVE",
  subscription: {
    id: "sub-1",
    status: "ACTIVE",
    startDate: toServiceDate("2026-07-01"),
    endDate: toServiceDate("2026-07-31"),
    includedMealSlots: ["LUNCH", "DINNER"],
  },
  ...over,
});

let attendance: FakeAttendanceRepository;
let students: FakeStudentRepository;
let tenants: FakeTenantRepository;
let messCuts: FakeMessCutRepository;
let audit: FakeAuditLogRepository;
let deps: VerifyAttendanceDeps;
let clock: Date;

beforeEach(() => {
  clock = DURING_LUNCH;
  attendance = new FakeAttendanceRepository();
  students = new FakeStudentRepository([student()]);
  tenants = new FakeTenantRepository();
  tenants.set(TENANT, settings, IST, SECRET);
  messCuts = new FakeMessCutRepository();
  audit = new FakeAuditLogRepository();
  deps = {
    tenants,
    students,
    attendance,
    messCuts,
    audit,
    signer: fakeSigner,
    now: () => clock,
  };
});

function mintToken(at: Date = DURING_LUNCH, slot: "LUNCH" | "DINNER" = "LUNCH"): string {
  return unwrap(
    issueToken({
      tenantId: TENANT,
      studentId: STUDENT,
      mealSlot: slot,
      settings,
      now: at,
      timezone: IST,
      secret: SECRET,
      nonce: `n-${at.getTime()}-${slot}`,
      signer: fakeSigner,
    }),
  ).token;
}

describe("verifyQrAttendance — success", () => {
  it("serves a valid student and returns the identity staff must eyeball", () => {
    return verifyQrAttendance(staffCtx, { token: mintToken(), deviceId: "tablet-1" }, deps).then(
      (result) => {
        expect(isOk(result)).toBe(true);
        if (isOk(result)) {
          // §6.3: "Staff must see the student's name and photo on success."
          // The QR proves possession of a phone, not identity.
          expect(result.value.fullName).toBe("Aarav Sharma");
          expect(result.value.photoUrl).toBe("https://example.test/photo.jpg");
          expect(result.value.rollNumber).toBe("CS21B001");
          expect(result.value.mealSlot).toBe("LUNCH");
          expect(result.value.serviceDate).toBe("2026-07-15");
        }
        expect(attendance.rows).toHaveLength(1);
      },
    );
  });

  it("does not audit-log ordinary QR scans", async () => {
    await verifyQrAttendance(staffCtx, { token: mintToken(), deviceId: null }, deps);
    // 600 routine scans a day would bury the overrides that need review.
    expect(audit.entries).toHaveLength(0);
  });
});

describe("verifyQrAttendance — idempotency (§10, non-negotiable)", () => {
  it("same QR scanned twice: second returns ALREADY_SERVED and writes no second row", async () => {
    const token = mintToken();

    const first = await verifyQrAttendance(staffCtx, { token, deviceId: "tablet-1" }, deps);
    expect(isOk(first)).toBe(true);

    const second = await verifyQrAttendance(staffCtx, { token, deviceId: "tablet-1" }, deps);
    expect(isErr(second)).toBe(true);
    if (isErr(second)) {
      expect(second.error.code).toBe("ALREADY_SERVED");
      expect(second.error.details?.servedAt).toBe(DURING_LUNCH.toISOString());
    }

    expect(attendance.rows).toHaveLength(1);
  });

  it("rejects a second scan even from a different device with a fresh token", async () => {
    // The friend-with-a-screenshot case, and the two-counters case.
    await verifyQrAttendance(staffCtx, { token: mintToken(), deviceId: "tablet-1" }, deps);

    clock = new Date(DURING_LUNCH.getTime() + 20_000);
    const fresh = mintToken(clock);
    const second = await verifyQrAttendance(staffCtx, { token: fresh, deviceId: "tablet-2" }, deps);

    expect(isErr(second)).toBe(true);
    if (isErr(second)) expect(second.error.code).toBe("ALREADY_SERVED");
    expect(attendance.rows).toHaveLength(1);
  });

  it("allows the same student to eat a different meal the same day", async () => {
    await verifyQrAttendance(staffCtx, { token: mintToken(), deviceId: null }, deps);

    // 20:00 IST — dinner service.
    clock = new Date("2026-07-15T14:30:00Z");
    const dinner = await verifyQrAttendance(
      staffCtx,
      { token: mintToken(clock, "DINNER"), deviceId: null },
      deps,
    );

    expect(isOk(dinner)).toBe(true);
    expect(attendance.rows).toHaveLength(2);
  });
});

describe("verifyQrAttendance — account checks", () => {
  it("denies a BLOCKED student", async () => {
    students = new FakeStudentRepository([student({ status: "BLOCKED" })]);
    deps = { ...deps, students };

    const result = await verifyQrAttendance(staffCtx, { token: mintToken(), deviceId: null }, deps);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("BLOCKED_UNPAID");
    expect(attendance.rows).toHaveLength(0);
  });

  it("serves a GRACE student — they are inside the grace period", async () => {
    students = new FakeStudentRepository([student({ status: "GRACE" })]);
    deps = { ...deps, students };

    const result = await verifyQrAttendance(staffCtx, { token: mintToken(), deviceId: null }, deps);
    expect(isOk(result)).toBe(true);
  });

  it("denies a student with no subscription", async () => {
    students = new FakeStudentRepository([student({ subscription: null })]);
    deps = { ...deps, students };

    const result = await verifyQrAttendance(staffCtx, { token: mintToken(), deviceId: null }, deps);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("NO_ACTIVE_PLAN");
  });

  it("denies when the subscription term does not cover today", async () => {
    students = new FakeStudentRepository([
      student({
        subscription: {
          id: "sub-1",
          status: "ACTIVE",
          startDate: toServiceDate("2026-06-01"),
          endDate: toServiceDate("2026-06-30"),
          includedMealSlots: ["LUNCH", "DINNER"],
        },
      }),
    ]);
    deps = { ...deps, students };

    const result = await verifyQrAttendance(staffCtx, { token: mintToken(), deviceId: null }, deps);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("NO_ACTIVE_PLAN");
  });

  it("denies a meal the plan does not include", async () => {
    students = new FakeStudentRepository([
      student({
        subscription: {
          id: "sub-1",
          status: "ACTIVE",
          startDate: toServiceDate("2026-07-01"),
          endDate: toServiceDate("2026-07-31"),
          includedMealSlots: ["DINNER"],
        },
      }),
    ]);
    deps = { ...deps, students };

    const result = await verifyQrAttendance(staffCtx, { token: mintToken(), deviceId: null }, deps);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("NO_ACTIVE_PLAN");
  });

  it("denies a student on an approved mess cut", async () => {
    messCuts.add({
      studentId: STUDENT,
      dateFrom: toServiceDate("2026-07-15"),
      dateTo: toServiceDate("2026-07-15"),
      mealSlots: ["LUNCH"],
      status: "APPROVED",
    });

    const result = await verifyQrAttendance(staffCtx, { token: mintToken(), deviceId: null }, deps);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("ON_MESS_CUT");
    expect(attendance.rows).toHaveLength(0);
  });

  it("serves dinner when only lunch was cut", async () => {
    messCuts.add({
      studentId: STUDENT,
      dateFrom: toServiceDate("2026-07-15"),
      dateTo: toServiceDate("2026-07-15"),
      mealSlots: ["LUNCH"],
      status: "APPROVED",
    });

    clock = new Date("2026-07-15T14:30:00Z");
    const result = await verifyQrAttendance(
      staffCtx,
      { token: mintToken(clock, "DINNER"), deviceId: null },
      deps,
    );
    expect(isOk(result)).toBe(true);
  });

  it("ignores a cancelled cut", async () => {
    messCuts.add({
      studentId: STUDENT,
      dateFrom: toServiceDate("2026-07-15"),
      dateTo: toServiceDate("2026-07-15"),
      mealSlots: ["LUNCH"],
      status: "CANCELLED",
    });

    const result = await verifyQrAttendance(staffCtx, { token: mintToken(), deviceId: null }, deps);
    expect(isOk(result)).toBe(true);
  });
});

describe("verifyQrAttendance — authorization and tenancy", () => {
  it("refuses a student trying to mark their own attendance", async () => {
    const studentCtx: TenantContext = { ...staffCtx, role: "STUDENT", studentId: STUDENT };
    const result = await verifyQrAttendance(
      studentCtx,
      { token: mintToken(), deviceId: null },
      deps,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("FORBIDDEN");
    expect(attendance.rows).toHaveLength(0);
  });

  it("allows an admin to operate the counter", async () => {
    const adminCtx: TenantContext = { ...staffCtx, role: "ADMIN" };
    expect(
      isOk(await verifyQrAttendance(adminCtx, { token: mintToken(), deviceId: null }, deps)),
    ).toBe(true);
  });

  it("refuses a token minted by another tenant", async () => {
    const foreign = unwrap(
      issueToken({
        tenantId: OTHER_TENANT,
        studentId: STUDENT,
        mealSlot: "LUNCH",
        settings,
        now: DURING_LUNCH,
        timezone: IST,
        secret: "a-completely-different-tenant-secret-value",
        nonce: "n",
        signer: fakeSigner,
      }),
    ).token;

    const result = await verifyQrAttendance(staffCtx, { token: foreign, deviceId: null }, deps);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("INVALID_TOKEN");
  });
});

describe("verifyQrAttendance — fails closed (§2.7)", () => {
  it("denies the scan when tenant settings cannot be read", async () => {
    deps = { ...deps, tenants: new FakeTenantRepository() };
    const result = await verifyQrAttendance(staffCtx, { token: mintToken(), deviceId: null }, deps);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("INFRASTRUCTURE_ERROR");
  });

  it("denies the scan when the attendance write fails, and records nothing", async () => {
    attendance.failNextWrite = true;
    const result = await verifyQrAttendance(staffCtx, { token: mintToken(), deviceId: null }, deps);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("INFRASTRUCTURE_ERROR");
    expect(attendance.rows).toHaveLength(0);
  });

  it("denies an unknown student", async () => {
    deps = { ...deps, students: new FakeStudentRepository([]) };
    const result = await verifyQrAttendance(staffCtx, { token: mintToken(), deviceId: null }, deps);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("NOT_FOUND");
  });
});

describe("verifyManualAttendance — the audited fallback (§6.4)", () => {
  it("serves by roll number and audit-logs the override", async () => {
    const result = await verifyManualAttendance(
      staffCtx,
      {
        rollNumber: "cs21b001", // case-insensitive; staff type fast
        mealSlot: "LUNCH",
        reason: "Student phone battery dead",
        deviceId: "tablet-1",
      },
      deps,
    );

    expect(isOk(result)).toBe(true);
    expect(attendance.rows).toHaveLength(1);
    expect(attendance.rows[0]?.method).toBe("MANUAL");

    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]).toMatchObject({
      action: "ATTENDANCE_MANUAL_OVERRIDE",
      actorProfileId: "staff-profile-1",
      tenantId: TENANT,
    });
  });

  it("requires a reason", async () => {
    const result = await verifyManualAttendance(
      staffCtx,
      { rollNumber: "CS21B001", mealSlot: "LUNCH", reason: "   ", deviceId: null },
      deps,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("VALIDATION_FAILED");
    expect(attendance.rows).toHaveLength(0);
  });

  it("runs the same account checks as a QR scan — it is not a bypass", async () => {
    students = new FakeStudentRepository([student({ status: "BLOCKED" })]);
    deps = { ...deps, students };

    const result = await verifyManualAttendance(
      staffCtx,
      { rollNumber: "CS21B001", mealSlot: "LUNCH", reason: "No phone", deviceId: null },
      deps,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("BLOCKED_UNPAID");
  });

  it("is idempotent against a prior QR scan for the same meal", async () => {
    await verifyQrAttendance(staffCtx, { token: mintToken(), deviceId: null }, deps);

    const manual = await verifyManualAttendance(
      staffCtx,
      { rollNumber: "CS21B001", mealSlot: "LUNCH", reason: "Scanner froze", deviceId: null },
      deps,
    );

    expect(isErr(manual)).toBe(true);
    if (isErr(manual)) expect(manual.error.code).toBe("ALREADY_SERVED");
    expect(attendance.rows).toHaveLength(1);
  });

  it("reports an unknown roll number", async () => {
    const result = await verifyManualAttendance(
      staffCtx,
      { rollNumber: "NOPE999", mealSlot: "LUNCH", reason: "Manual", deviceId: null },
      deps,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("NOT_FOUND");
  });

  it("refuses a slot the mess does not serve", async () => {
    const result = await verifyManualAttendance(
      staffCtx,
      { rollNumber: "CS21B001", mealSlot: "BREAKFAST", reason: "Manual", deviceId: null },
      deps,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("SLOT_NOT_SERVED");
  });

  it("refuses a student operating the manual path", async () => {
    const studentCtx: TenantContext = { ...staffCtx, role: "STUDENT", studentId: STUDENT };
    const result = await verifyManualAttendance(
      studentCtx,
      { rollNumber: "CS21B001", mealSlot: "LUNCH", reason: "Let me in", deviceId: null },
      deps,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("FORBIDDEN");
  });
});
