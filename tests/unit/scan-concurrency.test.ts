/**
 * Concurrency and replay on the scan path.
 *
 * Closes the test-debt item "two concurrent scans of one student → exactly one
 * attendance row". This is not hypothetical: two counters serving one queue is
 * the normal arrangement at 300+ students, and the offline queue replays
 * whatever it buffered the moment Wi-Fi returns. Both must converge on one row.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  verifyManualAttendance,
  verifyQrAttendance,
  type VerifyAttendanceDeps,
} from "@/core/services/verify-attendance";
import { issueToken } from "@/core/policies/qr.policy";
import type { TenantContext, TenantSettings } from "@/core/domain/tenant-context";
import type { StudentForVerification } from "@/core/ports/repositories";
import { toServiceDate, toWallClockTime, serviceDateOf } from "@/core/time";
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
const STUDENT = "33333333-3333-3333-3333-333333333333";
const SECRET = "tenant-signing-secret-at-least-32-characters";
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
  tenantSlug: "unversity-mess",
  timezone: IST,
  actorProfileId: "staff-profile-1",
  role: "STAFF",
};

const student: StudentForVerification = {
  studentId: STUDENT,
  tenantId: TENANT,
  rollNumber: "CS21B001",
  fullName: "Aarav Sharma",
  photoUrl: null,
  status: "ACTIVE",
  subscription: {
    id: "sub-1",
    status: "ACTIVE",
    startDate: toServiceDate("2026-07-01"),
    endDate: toServiceDate("2026-07-31"),
    includedMealSlots: ["LUNCH", "DINNER"],
  },
};

let attendance: FakeAttendanceRepository;
let deps: VerifyAttendanceDeps;

function mintToken(at: Date = DURING_LUNCH): string {
  const issued = issueToken({
    tenantId: TENANT,
    studentId: STUDENT,
    mealSlot: "LUNCH",
    serviceDate: serviceDateOf(IST, at),
    settings,
    now: at,
    timezone: IST,
    secret: SECRET,
    nonce: Math.random().toString(36).slice(2),
    signer: fakeSigner,
  });
  if (!isOk(issued)) throw new Error("token issuance failed in test setup");
  return unwrap(issued).token;
}

beforeEach(() => {
  const tenants = new FakeTenantRepository();
  tenants.set(TENANT, settings, IST, SECRET);
  attendance = new FakeAttendanceRepository();
  deps = {
    tenants,
    students: new FakeStudentRepository([student]),
    attendance,
    messCuts: new FakeMessCutRepository([]),
    audit: new FakeAuditLogRepository(),
    signer: fakeSigner,
    now: () => DURING_LUNCH,
  };
});

describe("two counters scanning the same student at once", () => {
  it("writes exactly one attendance row", async () => {
    // Two distinct valid tokens — as if the student's screen rotated between
    // the two scans, which is what actually happens.
    const [first, second] = await Promise.all([
      verifyQrAttendance(staffCtx, { token: mintToken(), deviceId: "counter-a" }, deps),
      verifyQrAttendance(staffCtx, { token: mintToken(), deviceId: "counter-b" }, deps),
    ]);

    expect(attendance.rows).toHaveLength(1);

    // One succeeds, one is told the meal was already served — never two
    // successes, and never two failures.
    const outcomes = [first, second];
    expect(outcomes.filter(isOk)).toHaveLength(1);
    expect(outcomes.filter(isErr)).toHaveLength(1);

    const refused = outcomes.find(isErr);
    if (refused) expect(refused.error.code).toBe("ALREADY_SERVED");
  });

  it("still writes one row when five counters scan simultaneously", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        verifyQrAttendance(staffCtx, { token: mintToken(), deviceId: `counter-${i}` }, deps),
      ),
    );

    expect(attendance.rows).toHaveLength(1);
    expect(results.filter(isOk)).toHaveLength(1);
    expect(results.filter(isErr)).toHaveLength(4);
  });

  it("does not consume a second meal slot", async () => {
    await Promise.all([
      verifyQrAttendance(staffCtx, { token: mintToken(), deviceId: "a" }, deps),
      verifyQrAttendance(staffCtx, { token: mintToken(), deviceId: "b" }, deps),
    ]);
    expect(attendance.rows[0]?.mealSlot).toBe("LUNCH");
    expect(attendance.rows.filter((r) => r.mealSlot === "LUNCH")).toHaveLength(1);
  });
});

describe("a manual override whose audit entry cannot be written", () => {
  it("does not throw — the attendance row is already committed", async () => {
    const audit = new FakeAuditLogRepository();
    audit.failWrites = true;
    const localDeps = { ...deps, audit };

    // Must not reject: an uncaught throw here becomes a 500 at the counter,
    // while the student has already been recorded as served.
    const result = await verifyManualAttendance(
      staffCtx,
      { rollNumber: "CS21B001", mealSlot: "LUNCH", reason: "phone dead", deviceId: "counter-a" },
      localDeps,
    );

    expect(isOk(result)).toBe(true);
    expect(attendance.rows).toHaveLength(1);
  });

  it("reports that the override was not logged, rather than claiming success silently", async () => {
    const audit = new FakeAuditLogRepository();
    audit.failWrites = true;

    const result = await verifyManualAttendance(
      staffCtx,
      { rollNumber: "CS21B001", mealSlot: "LUNCH", reason: "phone dead", deviceId: "counter-a" },
      { ...deps, audit },
    );

    // An unexplained manual entry is exactly the row an admin will question
    // later. Staff must be told so a supervisor can be informed now.
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(unwrap(result).auditFailed).toBe(true);
  });

  it("does not set the flag when the audit entry succeeds", async () => {
    const result = await verifyManualAttendance(
      staffCtx,
      { rollNumber: "CS21B001", mealSlot: "LUNCH", reason: "phone dead", deviceId: "counter-a" },
      deps,
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(unwrap(result).auditFailed).toBeFalsy();
  });

  it("still serves the student — food is not withheld over a logging failure", async () => {
    const audit = new FakeAuditLogRepository();
    audit.failWrites = true;
    const result = await verifyManualAttendance(
      staffCtx,
      { rollNumber: "CS21B001", mealSlot: "LUNCH", reason: "phone dead", deviceId: "counter-a" },
      { ...deps, audit },
    );
    if (isOk(result)) expect(unwrap(result).fullName).toBe("Aarav Sharma");
  });
});

describe("offline queue replay", () => {
  it("is safe to replay the same buffered scan repeatedly", async () => {
    // The queue retries on reconnect and cannot know whether the original
    // request reached the server before the connection dropped.
    const token = mintToken();

    const first = await verifyQrAttendance(staffCtx, { token, deviceId: "counter-a" }, deps);
    expect(isOk(first)).toBe(true);

    for (let attempt = 0; attempt < 3; attempt++) {
      const replay = await verifyQrAttendance(staffCtx, { token, deviceId: "counter-a" }, deps);
      expect(isErr(replay)).toBe(true);
      if (isErr(replay)) expect(replay.error.code).toBe("ALREADY_SERVED");
    }

    expect(attendance.rows).toHaveLength(1);
  });

  it("records nothing when the write itself fails, so the queue can retry safely", async () => {
    attendance.failNextWrite = true;
    const result = await verifyQrAttendance(
      staffCtx,
      { token: mintToken(), deviceId: "counter-a" },
      deps,
    );

    // Fails closed: the student is not served, and no half-written row is left
    // that a retry would trip over.
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("INFRASTRUCTURE_ERROR");
    expect(attendance.rows).toHaveLength(0);

    // The retry then succeeds exactly once.
    const retry = await verifyQrAttendance(
      staffCtx,
      { token: mintToken(), deviceId: "counter-a" },
      deps,
    );
    expect(isOk(retry)).toBe(true);
    expect(attendance.rows).toHaveLength(1);
  });

  it("lets a different student through while one is a duplicate", async () => {
    const other: StudentForVerification = {
      ...student,
      studentId: "other",
      rollNumber: "CS21B009",
    };
    deps = { ...deps, students: new FakeStudentRepository([student, other]) };

    const otherToken = issueToken({
      tenantId: TENANT,
      studentId: "other",
      mealSlot: "LUNCH",
      serviceDate: serviceDateOf(IST, DURING_LUNCH),
      settings,
      now: DURING_LUNCH,
      timezone: IST,
      secret: SECRET,
      nonce: "n2",
      signer: fakeSigner,
    });
    if (!isOk(otherToken)) throw new Error("setup failed");

    await verifyQrAttendance(staffCtx, { token: mintToken(), deviceId: "a" }, deps);
    const duplicate = await verifyQrAttendance(
      staffCtx,
      { token: mintToken(), deviceId: "a" },
      deps,
    );
    const different = await verifyQrAttendance(
      staffCtx,
      { token: unwrap(otherToken).token, deviceId: "a" },
      deps,
    );

    expect(isErr(duplicate)).toBe(true);
    expect(isOk(different)).toBe(true);
    expect(attendance.rows).toHaveLength(2);
  });
});
