/**
 * A paused student cannot eat — proven through the real entry points.
 *
 * Spec §10 and §19 are emphatic that hiding the scanner in the UI is not
 * enough: "the operation must be blocked even if the request attempts to bypass
 * the hidden UI" (Case 12). So these tests never call the pause policy
 * directly. They go through `issueQrToken` (the student's phone) and both
 * `verifyQrAttendance` and `verifyManualAttendance` (the counter), which is
 * where a bypass would actually be attempted.
 *
 * That there are exactly three entry points, all funnelling through
 * `checkMealEligibility`, is why this feature is cheap to enforce. If a fourth
 * appears, it will fail to compile without a `pauses` array.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  verifyManualAttendance,
  verifyQrAttendance,
  type VerifyAttendanceDeps,
} from "@/core/services/verify-attendance";
import { issueQrToken, type IssueQrTokenDeps } from "@/core/services/issue-qr-token";
import { issueToken } from "@/core/policies/qr.policy";
import type { PauseRecord } from "@/core/policies/pause.policy";
import type { TenantContext, TenantSettings } from "@/core/domain/tenant-context";
import type { StudentForVerification } from "@/core/ports/repositories";
import { toWallClockTime, toServiceDate, serviceDateOf } from "@/core/time";
import { isErr, isOk, unwrap } from "@/core/result";
import {
  FakeAttendanceRepository,
  FakeAuditLogRepository,
  FakeMessCutRepository,
  FakeStudentRepository,
  FakeTenantRepository,
  fakeSigner,
  tenantSettings,
} from "../fakes";

const IST = "Asia/Kolkata";
const TENANT = "11111111-1111-1111-1111-111111111111";
const STUDENT = "33333333-3333-3333-3333-333333333333";
const SECRET = "tenant-signing-secret-at-least-32-characters";

/** 13:00 IST on 15 July 2026 — inside the lunch window. */
const DURING_LUNCH = new Date("2026-07-15T07:30:00Z");

const settings: TenantSettings = tenantSettings({
  tenantId: TENANT,
  mealSlots: [
    { slot: "LUNCH", start: toWallClockTime("12:00"), end: toWallClockTime("14:30") },
    { slot: "DINNER", start: toWallClockTime("19:30"), end: toWallClockTime("22:00") },
  ],
  qrTokenTtlSeconds: 30,
  qrRefreshSeconds: 15,
});

const staffCtx: TenantContext = {
  tenantId: TENANT,
  tenantSlug: "demo-hostel",
  timezone: IST,
  actorProfileId: "staff-profile-1",
  role: "STAFF",
};

const studentCtx: TenantContext = {
  tenantId: TENANT,
  tenantSlug: "demo-hostel",
  timezone: IST,
  actorProfileId: "student-profile-1",
  role: "STUDENT",
  studentId: STUDENT,
};

/** A pause covering 15 July, the day every test below serves lunch on. */
const coveringToday: PauseRecord = {
  status: "ACTIVE",
  startDate: toServiceDate("2026-07-14"),
  resumeDate: toServiceDate("2026-07-20"),
};

function student(pauses: readonly PauseRecord[]): StudentForVerification {
  return {
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
      pauses,
    },
  };
}

let attendance: FakeAttendanceRepository;
let students: FakeStudentRepository;
let tenants: FakeTenantRepository;
let messCuts: FakeMessCutRepository;
let audit: FakeAuditLogRepository;
let verifyDeps: VerifyAttendanceDeps;
let issueDeps: IssueQrTokenDeps;

function setUp(pauses: readonly PauseRecord[]): void {
  attendance = new FakeAttendanceRepository();
  students = new FakeStudentRepository([student(pauses)]);
  tenants = new FakeTenantRepository();
  tenants.set(TENANT, settings, IST, SECRET);
  messCuts = new FakeMessCutRepository();
  audit = new FakeAuditLogRepository();
  verifyDeps = {
    tenants,
    students,
    attendance,
    messCuts,
    audit,
    signer: fakeSigner,
    now: () => DURING_LUNCH,
  };
  issueDeps = {
    tenants,
    students,
    messCuts,
    attendance,
    signer: fakeSigner,
    now: () => DURING_LUNCH,
    nonce: () => "fixed-nonce",
  };
}

beforeEach(() => setUp([coveringToday]));

function mintToken(): string {
  return unwrap(
    issueToken({
      tenantId: TENANT,
      studentId: STUDENT,
      mealSlot: "LUNCH",
      serviceDate: serviceDateOf(IST, DURING_LUNCH),
      settings,
      now: DURING_LUNCH,
      timezone: IST,
      secret: SECRET,
      nonce: "n-1",
      signer: fakeSigner,
    }),
  ).token;
}

describe("a running pause blocks every path to a meal", () => {
  it("refuses to mint a QR code on the student's phone (AC7, AC8)", async () => {
    // Denying at issuance is not an optimisation. A paused student who can
    // still mint a code will queue, be refused in front of everyone, and argue
    // with staff who cannot explain it.
    const result = await issueQrToken(studentCtx, issueDeps);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("SUBSCRIPTION_PAUSED");
  });

  it("refuses a scan at the counter (Case 12)", async () => {
    // The bypass case: a token minted before the pause was configured, or
    // replayed from the offline queue. The counter re-runs eligibility, so the
    // stale token buys nothing.
    const result = await verifyQrAttendance(
      staffCtx,
      { token: mintToken(), deviceId: null },
      verifyDeps,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("SUBSCRIPTION_PAUSED");
  });

  it("refuses the manual fallback too — it is not a bypass (§19)", async () => {
    // Staff typing a roll number must hit the identical wall. Otherwise the
    // documented fallback becomes the documented workaround.
    const result = await verifyManualAttendance(
      staffCtx,
      { rollNumber: "CS21B001", mealSlot: "LUNCH", reason: "Phone battery dead", deviceId: null },
      verifyDeps,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("SUBSCRIPTION_PAUSED");
  });

  it("writes no attendance row when it refuses", async () => {
    await verifyQrAttendance(staffCtx, { token: mintToken(), deviceId: null }, verifyDeps);
    await verifyManualAttendance(
      staffCtx,
      { rollNumber: "CS21B001", mealSlot: "LUNCH", reason: "Phone battery dead", deviceId: null },
      verifyDeps,
    );
    expect(attendance.rows).toHaveLength(0);
  });
});

describe("a pause that does not cover today lets the student eat", () => {
  it("allows meals before the pause starts (§13 Scheduled)", async () => {
    setUp([
      {
        status: "ACTIVE",
        startDate: toServiceDate("2026-07-20"),
        resumeDate: toServiceDate("2026-07-25"),
      },
    ]);
    const result = await verifyQrAttendance(
      staffCtx,
      { token: mintToken(), deviceId: null },
      verifyDeps,
    );
    expect(isOk(result)).toBe(true);
  });

  it("allows meals from the resume date onward (AC9)", async () => {
    // The boundary AC9 turns on: 15 July is the resume date, so the student
    // eats. Nothing ran to make this true — it is derived from the dates.
    setUp([
      {
        status: "ACTIVE",
        startDate: toServiceDate("2026-07-10"),
        resumeDate: toServiceDate("2026-07-15"),
      },
    ]);
    const result = await verifyQrAttendance(
      staffCtx,
      { token: mintToken(), deviceId: null },
      verifyDeps,
    );
    expect(isOk(result)).toBe(true);
  });

  it("ignores a cancelled pause entirely (AC13)", async () => {
    setUp([{ ...coveringToday, status: "CANCELLED" }]);
    const result = await verifyQrAttendance(
      staffCtx,
      { token: mintToken(), deviceId: null },
      verifyDeps,
    );
    expect(isOk(result)).toBe(true);
  });

  it("leaves students with no pause at all untouched", async () => {
    // The overwhelmingly common case, and the backward-compatibility guarantee:
    // every existing student has an empty array here.
    setUp([]);
    const result = await verifyQrAttendance(
      staffCtx,
      { token: mintToken(), deviceId: null },
      verifyDeps,
    );
    expect(isOk(result)).toBe(true);
  });
});
