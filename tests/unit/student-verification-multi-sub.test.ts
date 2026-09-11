import { describe, expect, it } from "vitest";
import { MealSlot, UserRole } from "@/core/domain/enums";
import type { TenantContext } from "@/core/domain/tenant-context";
import { checkMealEligibility } from "@/core/policies/eligibility.policy";
import { requestAbsenceForStudent } from "@/core/services/request-absence";
import type { StudentForVerification, SubscriptionForVerification } from "@/core/ports/repositories";
import { toServiceDate, toWallClockTime } from "@/core/time";
import { isErr, isOk, unwrap } from "@/core/result";
import {
  FakeMessCutRepository,
  FakeStudentRepository,
  FakeTenantRepository,
  tenantSettings,
} from "../fakes";

const TENANT = "11111111-1111-1111-1111-111111111111";
const STUDENT = "33333333-3333-3333-3333-333333333333";
const IST = "Asia/Kolkata";

const SETTINGS = tenantSettings({
  tenantId: TENANT,
  mealSlots: [
    { slot: MealSlot.LUNCH, start: toWallClockTime("12:00"), end: toWallClockTime("14:30") },
    { slot: MealSlot.DINNER, start: toWallClockTime("19:30"), end: toWallClockTime("22:00") },
  ],
  allowMealSkipping: true,
  allowPartialDaySkip: true,
  allowAwayRequests: true,
  awayRequiresApproval: true,
  cutAdvanceHours: 12,
  cutMaxDaysPerMonth: 5,
  awayAdvanceHours: 24,
  awayMaxDays: 30,
});

function ctx(over: Partial<TenantContext> = {}): TenantContext {
  return {
    tenantId: TENANT,
    role: UserRole.STUDENT,
    studentId: STUDENT,
    actorProfileId: "profile-1",
    timezone: IST,
    ...over,
  } as TenantContext;
}

describe("Multi-subscription verification and eligibility (renewals)", () => {
  const currentTerm: SubscriptionForVerification = {
    id: "sub-current",
    status: "ACTIVE",
    startDate: toServiceDate("2026-09-01"),
    endDate: toServiceDate("2026-09-30"),
    includedMealSlots: [MealSlot.LUNCH, MealSlot.DINNER],
    pauses: [],
  };

  const renewedTerm: SubscriptionForVerification = {
    id: "sub-renewed",
    status: "ACTIVE",
    startDate: toServiceDate("2026-10-01"),
    endDate: toServiceDate("2026-10-31"),
    includedMealSlots: [MealSlot.LUNCH, MealSlot.DINNER],
    pauses: [],
  };

  it("approves student for current term when renewed term is listed first (arbitrary PostgREST order)", () => {
    // Crucial test: PostgREST returned the renewed October term before the current September term
    const student: StudentForVerification = {
      studentId: STUDENT,
      tenantId: TENANT,
      rollNumber: "CS21B001",
      fullName: "Aarav Sharma",
      photoUrl: null,
      status: "ACTIVE",
      subscriptions: [renewedTerm, currentTerm],
      subscription: renewedTerm, // legacy fallback pointing to the wrong one
    };

    const result = checkMealEligibility({
      student,
      expectedTenantId: TENANT,
      mealSlot: MealSlot.LUNCH,
      serviceDate: toServiceDate("2026-09-15"),
      cuts: [],
    });

    expect(isOk(result)).toBe(true);
    expect(unwrap(result).rollNumber).toBe("CS21B001");
  });

  it("approves student for renewed term when date advances into next month", () => {
    const student: StudentForVerification = {
      studentId: STUDENT,
      tenantId: TENANT,
      rollNumber: "CS21B001",
      fullName: "Aarav Sharma",
      photoUrl: null,
      status: "ACTIVE",
      subscriptions: [currentTerm, renewedTerm],
      subscription: currentTerm,
    };

    const result = checkMealEligibility({
      student,
      expectedTenantId: TENANT,
      mealSlot: MealSlot.LUNCH,
      serviceDate: toServiceDate("2026-10-05"),
      cuts: [],
    });

    expect(isOk(result)).toBe(true);
  });

  it("refuses student on dates outside all active subscriptions", () => {
    const student: StudentForVerification = {
      studentId: STUDENT,
      tenantId: TENANT,
      rollNumber: "CS21B001",
      fullName: "Aarav Sharma",
      photoUrl: null,
      status: "ACTIVE",
      subscriptions: [currentTerm, renewedTerm],
    };

    const result = checkMealEligibility({
      student,
      expectedTenantId: TENANT,
      mealSlot: MealSlot.LUNCH,
      serviceDate: toServiceDate("2026-11-01"),
      cuts: [],
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe("NO_ACTIVE_PLAN");
      expect(result.error.message).toContain("plan does not cover today");
    }
  });

  it("preserves backward compatibility when student object only has legacy subscription property", () => {
    const student: StudentForVerification = {
      studentId: STUDENT,
      tenantId: TENANT,
      rollNumber: "CS21B001",
      fullName: "Aarav Sharma",
      photoUrl: null,
      status: "ACTIVE",
      subscription: currentTerm,
    };

    const result = checkMealEligibility({
      student,
      expectedTenantId: TENANT,
      mealSlot: MealSlot.LUNCH,
      serviceDate: toServiceDate("2026-09-15"),
      cuts: [],
    });

    expect(isOk(result)).toBe(true);
  });

  it("respects pauses on the specific active term without corrupting other terms", () => {
    const pausedCurrentTerm: SubscriptionForVerification = {
      ...currentTerm,
      pauses: [
        {
          status: "ACTIVE",
          startDate: toServiceDate("2026-09-10"),
          resumeDate: toServiceDate("2026-09-20"),
        },
      ],
    };

    const student: StudentForVerification = {
      studentId: STUDENT,
      tenantId: TENANT,
      rollNumber: "CS21B001",
      fullName: "Aarav Sharma",
      photoUrl: null,
      status: "ACTIVE",
      subscriptions: [pausedCurrentTerm, renewedTerm],
    };

    // Date inside pause in September -> refused with SUBSCRIPTION_PAUSED
    const duringPause = checkMealEligibility({
      student,
      expectedTenantId: TENANT,
      mealSlot: MealSlot.LUNCH,
      serviceDate: toServiceDate("2026-09-15"),
      cuts: [],
    });
    expect(isErr(duringPause)).toBe(true);
    if (isErr(duringPause)) {
      expect(duringPause.error.code).toBe("SUBSCRIPTION_PAUSED");
    }

    // Date in October (renewed term) -> not affected by September pause
    const inOctober = checkMealEligibility({
      student,
      expectedTenantId: TENANT,
      mealSlot: MealSlot.LUNCH,
      serviceDate: toServiceDate("2026-10-05"),
      cuts: [],
    });
    expect(isOk(inOctober)).toBe(true);
  });
});

describe("Absence requests with renewed subscriptions", () => {
  const currentTerm: SubscriptionForVerification = {
    id: "sub-sep",
    status: "ACTIVE",
    startDate: toServiceDate("2026-09-01"),
    endDate: toServiceDate("2026-09-30"),
    includedMealSlots: [MealSlot.LUNCH, MealSlot.DINNER],
    pauses: [],
  };

  const renewedTerm: SubscriptionForVerification = {
    id: "sub-oct",
    status: "ACTIVE",
    startDate: toServiceDate("2026-10-01"),
    endDate: toServiceDate("2026-10-31"),
    includedMealSlots: [MealSlot.LUNCH, MealSlot.DINNER],
    pauses: [],
  };

  function setup(studentSubs: SubscriptionForVerification[]) {
    const tenants = new FakeTenantRepository();
    tenants.set(TENANT, SETTINGS, IST, "secret");

    const students = new FakeStudentRepository();
    students.add({
      studentId: STUDENT,
      tenantId: TENANT,
      rollNumber: "CS21B001",
      fullName: "Aarav Sharma",
      photoUrl: null,
      status: "ACTIVE",
      subscriptions: studentSubs,
      subscription: studentSubs[0] ?? null,
    });

    const messCuts = new FakeMessCutRepository();
    // 10:00 IST on 2026-09-05
    const now = () => new Date("2026-09-05T04:30:00Z");

    return { tenants, students, messCuts, now };
  }

  it("allows student to request absence during the current term", async () => {
    const deps = setup([renewedTerm, currentTerm]); // Note reverse order
    const result = await requestAbsenceForStudent(
      ctx(),
      {
        kind: "SKIP",
        dateFrom: toServiceDate("2026-09-12"),
        dateTo: toServiceDate("2026-09-12"),
        mealSlots: [MealSlot.LUNCH],
      },
      deps,
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.subscriptionId).toBe("sub-sep");
    }
  });

  it("allows student to request absence during the upcoming renewed term", async () => {
    const deps = setup([currentTerm, renewedTerm]);
    const result = await requestAbsenceForStudent(
      ctx(),
      {
        kind: "AWAY",
        dateFrom: toServiceDate("2026-10-10"),
        dateTo: toServiceDate("2026-10-15"),
        mealSlots: [MealSlot.LUNCH, MealSlot.DINNER],
      },
      deps,
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.subscriptionId).toBe("sub-oct");
    }
  });

  it("refuses absence request that falls outside all subscription periods", async () => {
    const deps = setup([currentTerm, renewedTerm]);
    const result = await requestAbsenceForStudent(
      ctx(),
      {
        kind: "AWAY",
        dateFrom: toServiceDate("2026-11-05"),
        dateTo: toServiceDate("2026-11-10"),
        mealSlots: [MealSlot.LUNCH, MealSlot.DINNER],
      },
      deps,
    );

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe("VALIDATION_FAILED");
    }
  });
});
