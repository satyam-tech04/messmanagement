/**
 * Tests for QR token issuance.
 *
 * §6.1 requires account status to be checked at issuance **and** re-checked at
 * verification. This file covers the issuance half, including the test-debt
 * item "blocked student's token issuance → denied": a blocked student who can
 * still mint a code will queue up, get refused at the counter with a queue
 * behind them, and argue with staff who cannot explain it. Denying at issuance
 * moves that conversation to the phone screen where it belongs.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { issueQrToken, type IssueQrTokenDeps } from "@/core/services/issue-qr-token";
import { verifyToken } from "@/core/policies/qr.policy";
import type { TenantContext, TenantSettings } from "@/core/domain/tenant-context";
import type { StudentForVerification } from "@/core/ports/repositories";
import { toServiceDate, toWallClockTime } from "@/core/time";
import { isErr, isOk, unwrap } from "@/core/result";
import {
  FakeMessCutRepository,
  FakeStudentRepository,
  FakeTenantRepository,
  fakeSigner,
} from "../fakes";

const IST = "Asia/Kolkata";
const TENANT = "11111111-1111-1111-1111-111111111111";
const STUDENT = "33333333-3333-3333-3333-333333333333";
const SECRET = "tenant-signing-secret-at-least-32-characters";

/** 13:00 IST on 15 July 2026 — inside the lunch window. */
const DURING_LUNCH = new Date("2026-07-15T07:30:00Z");
/** 16:30 IST — between meals. */
const BETWEEN_MEALS = new Date("2026-07-15T11:00:00Z");
/** 08:30 IST — before the first service. */
const BEFORE_LUNCH = new Date("2026-07-15T03:00:00Z");

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

const studentCtx: TenantContext = {
  tenantId: TENANT,
  tenantSlug: "unversity-mess",
  timezone: IST,
  actorProfileId: "student-profile-1",
  role: "STUDENT",
  studentId: STUDENT,
};

const student = (over: Partial<StudentForVerification> = {}): StudentForVerification => ({
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
  ...over,
});

let tenants: FakeTenantRepository;
let students: FakeStudentRepository;
let messCuts: FakeMessCutRepository;
let deps: IssueQrTokenDeps;

function build(now: Date): IssueQrTokenDeps {
  return {
    tenants,
    students,
    messCuts,
    signer: fakeSigner,
    now: () => now,
    nonce: () => "fixed-nonce",
  };
}

function tenantRepo(
  withSettings: TenantSettings | null = settings,
  secret: string | null = SECRET,
): FakeTenantRepository {
  const repo = new FakeTenantRepository();
  if (withSettings && secret) repo.set(TENANT, withSettings, IST, secret);
  else if (withSettings) repo.set(TENANT, withSettings, IST, "");
  return repo;
}

beforeEach(() => {
  tenants = tenantRepo();
  students = new FakeStudentRepository([student()]);
  messCuts = new FakeMessCutRepository([]);
  deps = build(DURING_LUNCH);
});

describe("issueQrToken — authorization", () => {
  it("issues for a student in good standing during a meal window", async () => {
    const result = await issueQrToken(studentCtx, deps);
    expect(isOk(result)).toBe(true);
  });

  it("refuses a context with no studentId — staff have nothing to show", async () => {
    const { studentId: _omit, ...withoutStudent } = studentCtx;
    const result = await issueQrToken(withoutStudent as TenantContext, deps);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("FORBIDDEN");
  });

  it("refuses a staff member — a counter operator must not mint a student's code", async () => {
    const staffCtx: TenantContext = {
      ...studentCtx,
      role: "STAFF",
      studentId: STUDENT,
    };
    const result = await issueQrToken(staffCtx, deps);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("FORBIDDEN");
  });
});

describe("issueQrToken — account status (§6.1, re-checked at verification)", () => {
  it("DENIES a blocked student — they must not reach the counter with a live code", async () => {
    students = new FakeStudentRepository([student({ status: "BLOCKED" })]);
    const result = await issueQrToken(studentCtx, build(DURING_LUNCH));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("BLOCKED_UNPAID");
  });

  it("denies an inactive student", async () => {
    students = new FakeStudentRepository([student({ status: "INACTIVE" })]);
    const result = await issueQrToken(studentCtx, build(DURING_LUNCH));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("STUDENT_INACTIVE");
  });

  it("allows a student in GRACE — grace exists precisely so they still eat", async () => {
    students = new FakeStudentRepository([student({ status: "GRACE" })]);
    const result = await issueQrToken(studentCtx, build(DURING_LUNCH));
    expect(isOk(result)).toBe(true);
  });

  it("denies a student with no subscription", async () => {
    students = new FakeStudentRepository([student({ subscription: null })]);
    const result = await issueQrToken(studentCtx, build(DURING_LUNCH));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("NO_ACTIVE_PLAN");
  });

  it("denies when the plan has expired before today", async () => {
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
    const result = await issueQrToken(studentCtx, build(DURING_LUNCH));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("NO_ACTIVE_PLAN");
  });

  it("denies when the plan does not include the meal being served", async () => {
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
    const result = await issueQrToken(studentCtx, build(DURING_LUNCH));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("NO_ACTIVE_PLAN");
  });

  it("denies a student who has cut this meal", async () => {
    messCuts = new FakeMessCutRepository([
      {
        studentId: STUDENT,
        dateFrom: toServiceDate("2026-07-15"),
        dateTo: toServiceDate("2026-07-15"),
        mealSlots: ["LUNCH", "DINNER"],
        status: "APPROVED",
      },
    ]);
    const result = await issueQrToken(studentCtx, build(DURING_LUNCH));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("ON_MESS_CUT");
  });
});

describe("issueQrToken — which meal the token is for", () => {
  it("mints for the meal currently being served", async () => {
    const result = await issueQrToken(studentCtx, build(DURING_LUNCH));
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(unwrap(result).mealSlot).toBe("LUNCH");
  });

  it("mints for the upcoming meal when between services", async () => {
    // 16:30 IST: lunch is over, dinner has not opened. Showing a lunch code
    // would be useless, and showing nothing would look broken.
    const result = await issueQrToken(studentCtx, build(BETWEEN_MEALS));
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(unwrap(result).mealSlot).toBe("DINNER");
  });

  it("mints for lunch before the day's first service", async () => {
    const result = await issueQrToken(studentCtx, build(BEFORE_LUNCH));
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(unwrap(result).mealSlot).toBe("LUNCH");
  });

  it("reports whether the meal is open now, so the screen can say so", async () => {
    const during = await issueQrToken(studentCtx, build(DURING_LUNCH));
    const between = await issueQrToken(studentCtx, build(BETWEEN_MEALS));
    if (isOk(during)) expect(unwrap(during).isOpenNow).toBe(true);
    if (isOk(between)) expect(unwrap(between).isOpenNow).toBe(false);
  });
});

describe("issueQrToken — the token itself", () => {
  it("produces a token the verifier accepts", async () => {
    const result = await issueQrToken(studentCtx, build(DURING_LUNCH));
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    const verified = verifyToken({
      token: unwrap(result).token,
      expectedTenantId: TENANT,
      settings,
      timezone: IST,
      secret: SECRET,
      now: DURING_LUNCH,
      signer: fakeSigner,
    });
    expect(isOk(verified)).toBe(true);
    if (isOk(verified)) {
      expect(unwrap(verified).studentId).toBe(STUDENT);
      expect(unwrap(verified).mealSlot).toBe("LUNCH");
    }
  });

  it("tells the screen to refresh before the token expires", async () => {
    // If refresh were >= TTL the student would be holding a dead code between
    // redraws, and would be refused at the counter through no fault of theirs.
    const result = await issueQrToken(studentCtx, build(DURING_LUNCH));
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(unwrap(result).refreshSeconds).toBeLessThan(settings.qrTokenTtlSeconds);
    }
  });

  it("fails closed when the signing secret cannot be read", async () => {
    tenants = tenantRepo(settings, null);
    const result = await issueQrToken(studentCtx, build(DURING_LUNCH));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("INFRASTRUCTURE_ERROR");
  });

  it("fails closed when tenant settings are missing", async () => {
    tenants = tenantRepo(null, SECRET);
    const result = await issueQrToken(studentCtx, build(DURING_LUNCH));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("INFRASTRUCTURE_ERROR");
  });

  it("never returns the tenant's signing secret to the caller", async () => {
    const result = await issueQrToken(studentCtx, build(DURING_LUNCH));
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(JSON.stringify(unwrap(result))).not.toContain(SECRET);
  });
});
