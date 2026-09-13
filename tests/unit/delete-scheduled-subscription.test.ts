/**
 * Removing a plan that has not started yet.
 *
 * An admin renewing early can pick the wrong plan or the wrong dates, and until
 * now nothing could take the mistake back: "End plan" is offered only on a
 * running term, so an upcoming one sat there holding its dates — and, through
 * the no-overlap constraint, blocking the correct renewal.
 *
 * The rule is narrow on purpose. A term that has started has meals served,
 * money attached and a history an owner will be asked about; that is ended,
 * never deleted. Only a term still in the future, with nothing hanging off it
 * that a student is relying on, may go.
 */
import { describe, expect, it } from "vitest";
import { UserRole } from "@/core/domain/enums";
import { canDeleteScheduledSubscription } from "@/core/policies/plan.policy";
import { toServiceDate } from "@/core/time";

const today = toServiceDate("2026-09-13");

const upcoming = {
  status: "ACTIVE",
  startDate: toServiceDate("2026-10-01"),
  endDate: toServiceDate("2026-10-31"),
};

const request = (over: Partial<Parameters<typeof canDeleteScheduledSubscription>[0]> = {}) =>
  canDeleteScheduledSubscription({
    actorRole: UserRole.ADMIN,
    subscription: upcoming,
    today,
    liveAbsences: 0,
    livePauses: 0,
    ...over,
  });

describe("canDeleteScheduledSubscription", () => {
  it("allows an admin to delete a plan that starts in the future", () => {
    expect(request().ok).toBe(true);
  });

  it("allows a super admin", () => {
    expect(request({ actorRole: UserRole.SUPER_ADMIN }).ok).toBe(true);
  });

  it("refuses staff", () => {
    const r = request({ actorRole: UserRole.STAFF });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });

  it("refuses a plan that starts today — it is running, so it is ended instead", () => {
    const r = request({ subscription: { ...upcoming, startDate: today } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/End plan/);
  });

  it("refuses a plan that has already run", () => {
    const r = request({
      subscription: {
        status: "ACTIVE",
        startDate: toServiceDate("2026-08-01"),
        endDate: toServiceDate("2026-08-31"),
      },
    });
    expect(r.ok).toBe(false);
  });

  it("refuses a plan that was already cancelled", () => {
    const r = request({ subscription: { ...upcoming, status: "CANCELLED" } });
    expect(r.ok).toBe(false);
  });

  it("refuses while the student has an absence request on it", () => {
    // Deleting the plan would silently delete the request with it.
    const r = request({ liveAbsences: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/absence/i);
  });

  it("refuses while a pause is set on it", () => {
    const r = request({ livePauses: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/pause/i);
  });
});
