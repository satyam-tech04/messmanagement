import { describe, it, expect } from "vitest";
import {
  ALL_MEAL_SLOTS,
  canTransitionStudentStatus,
  canTransitionSubscriptionStatus,
  MealSlot,
  StudentStatus,
  SubscriptionStatus,
} from "@/core/domain/enums";
import {
  findMealSlotConfig,
  hasAtLeastRole,
  hasRole,
  requireRole,
  requireSameTenant,
  type TenantContext,
  type TenantSettings,
} from "@/core/domain/tenant-context";
import { toWallClockTime } from "@/core/time";
import { isDenial, infrastructureError, illegalTransition, notFound } from "@/core/errors";
import { andThen, err, isErr, isOk, mapResult, ok, unwrap } from "@/core/result";

const ctx = (over: Partial<TenantContext> = {}): TenantContext => ({
  tenantId: "tenant-a",
  tenantSlug: "demo-hostel",
  timezone: "Asia/Kolkata",
  actorProfileId: "profile-1",
  role: "ADMIN",
  ...over,
});

describe("student status state machine (§2.6)", () => {
  it("allows the documented dues transitions", () => {
    expect(canTransitionStudentStatus(StudentStatus.ACTIVE, StudentStatus.GRACE)).toBe(true);
    expect(canTransitionStudentStatus(StudentStatus.GRACE, StudentStatus.BLOCKED)).toBe(true);
    expect(canTransitionStudentStatus(StudentStatus.GRACE, StudentStatus.ACTIVE)).toBe(true);
    expect(canTransitionStudentStatus(StudentStatus.BLOCKED, StudentStatus.ACTIVE)).toBe(true);
  });

  it("permits leaving and re-admitting", () => {
    expect(canTransitionStudentStatus(StudentStatus.ACTIVE, StudentStatus.INACTIVE)).toBe(true);
    expect(canTransitionStudentStatus(StudentStatus.INACTIVE, StudentStatus.ACTIVE)).toBe(true);
  });

  it("forbids skipping straight from INACTIVE into a dues state", () => {
    expect(canTransitionStudentStatus(StudentStatus.INACTIVE, StudentStatus.GRACE)).toBe(false);
    expect(canTransitionStudentStatus(StudentStatus.INACTIVE, StudentStatus.BLOCKED)).toBe(false);
  });

  it("forbids BLOCKED -> GRACE, which would weaken enforcement silently", () => {
    expect(canTransitionStudentStatus(StudentStatus.BLOCKED, StudentStatus.GRACE)).toBe(false);
  });

  it("treats a no-op transition as legal", () => {
    expect(canTransitionStudentStatus(StudentStatus.ACTIVE, StudentStatus.ACTIVE)).toBe(true);
  });
});

describe("subscription status state machine", () => {
  it("follows PENDING_PAYMENT -> ACTIVE -> EXPIRED", () => {
    expect(
      canTransitionSubscriptionStatus(
        SubscriptionStatus.PENDING_PAYMENT,
        SubscriptionStatus.ACTIVE,
      ),
    ).toBe(true);
    expect(
      canTransitionSubscriptionStatus(SubscriptionStatus.ACTIVE, SubscriptionStatus.EXPIRED),
    ).toBe(true);
  });

  it("treats EXPIRED and CANCELLED as terminal", () => {
    expect(
      canTransitionSubscriptionStatus(SubscriptionStatus.EXPIRED, SubscriptionStatus.ACTIVE),
    ).toBe(false);
    expect(
      canTransitionSubscriptionStatus(SubscriptionStatus.CANCELLED, SubscriptionStatus.ACTIVE),
    ).toBe(false);
  });

  it("forbids reviving a subscription straight from PENDING to EXPIRED", () => {
    expect(
      canTransitionSubscriptionStatus(
        SubscriptionStatus.PENDING_PAYMENT,
        SubscriptionStatus.EXPIRED,
      ),
    ).toBe(false);
  });
});

describe("meal slots", () => {
  it("enumerates every slot in the enum", () => {
    expect(ALL_MEAL_SLOTS).toHaveLength(4);
    expect(ALL_MEAL_SLOTS).toContain(MealSlot.LUNCH);
    expect(ALL_MEAL_SLOTS).toContain(MealSlot.DINNER);
  });
});

describe("tenant settings lookup", () => {
  const settings: TenantSettings = {
    tenantId: "tenant-a",
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

  it("finds a served slot", () => {
    expect(findMealSlotConfig(settings, "LUNCH")?.start).toBe("12:00");
  });

  it("returns undefined for a slot the tenant does not serve", () => {
    // The tenant serves lunch and dinner only — breakfast must not resolve to a
    // default window, it must be absent.
    expect(findMealSlotConfig(settings, "BREAKFAST")).toBeUndefined();
  });
});

describe("role authorization", () => {
  it("matches explicit role lists", () => {
    expect(hasRole(ctx({ role: "STAFF" }), "STAFF", "ADMIN")).toBe(true);
    expect(hasRole(ctx({ role: "STUDENT" }), "STAFF", "ADMIN")).toBe(false);
  });

  it("ranks roles for minimum-privilege checks", () => {
    expect(hasAtLeastRole(ctx({ role: "ADMIN" }), "STAFF")).toBe(true);
    expect(hasAtLeastRole(ctx({ role: "STAFF" }), "ADMIN")).toBe(false);
    expect(hasAtLeastRole(ctx({ role: "SUPER_ADMIN" }), "ADMIN")).toBe(true);
    expect(hasAtLeastRole(ctx({ role: "STUDENT" }), "STUDENT")).toBe(true);
  });

  it("returns a FORBIDDEN result rather than throwing", () => {
    const denied = requireRole(ctx({ role: "STUDENT" }), "ADMIN");
    expect(isErr(denied)).toBe(true);
    if (isErr(denied)) expect(denied.error.code).toBe("FORBIDDEN");

    expect(isOk(requireRole(ctx({ role: "ADMIN" }), "ADMIN"))).toBe(true);
  });

  it("rejects cross-tenant resources even though RLS would too", () => {
    const denied = requireSameTenant(ctx(), "tenant-b");
    expect(isErr(denied)).toBe(true);
    if (isErr(denied)) expect(denied.error.code).toBe("TENANT_MISMATCH");

    expect(isOk(requireSameTenant(ctx(), "tenant-a"))).toBe(true);
  });
});

describe("domain errors", () => {
  it("distinguishes a refusal from a fault, which drives scanner retry", () => {
    expect(isDenial(notFound("Student"))).toBe(true);
    expect(isDenial(infrastructureError("attendance write"))).toBe(false);
  });

  it("carries structured, PII-free detail", () => {
    const e = illegalTransition("Student", "BLOCKED", "GRACE");
    expect(e.code).toBe("ILLEGAL_TRANSITION");
    expect(e.details).toEqual({ from: "BLOCKED", to: "GRACE" });
  });
});

describe("Result", () => {
  it("maps and chains success", () => {
    expect(unwrap(mapResult(ok(2), (n) => n * 3))).toBe(6);
    expect(unwrap(andThen(ok(2), (n) => ok(n + 1)))).toBe(3);
  });

  it("short-circuits on failure", () => {
    const failure = err(notFound("Student"));
    expect(isErr(mapResult(failure, (n: number) => n * 3))).toBe(true);
    expect(isErr(andThen(failure, (n: number) => ok(n + 1)))).toBe(true);
  });

  it("throws when unwrapping a failure", () => {
    expect(() => unwrap(err(notFound("Student")))).toThrow(/unwrap called on a failed Result/);
  });
});
