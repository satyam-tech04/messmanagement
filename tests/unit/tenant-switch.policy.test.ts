/**
 * Moving a platform operator between messes.
 *
 * This is the one place in the product where crossing a tenant boundary is
 * legitimate, so it is also the one place where a mistake hands a stranger
 * another hostel's students. The cases below are therefore about who is
 * refused, not about who is allowed.
 */
import { describe, it, expect } from "vitest";
import {
  canSwitchTenant,
  parseTenantSwitch,
  type SwitchableTenant,
} from "@/core/policies/tenant-switch.policy";
import type { TenantContext } from "@/core/domain/tenant-context";
import type { UserRole } from "@/core/domain/enums";

const CAMPUS: SwitchableTenant = {
  id: "11111111-1111-1111-1111-111111111111",
  slug: "campus-crave",
  name: "Campus Crave",
  status: "ACTIVE",
};
const DEMO: SwitchableTenant = {
  id: "22222222-2222-2222-2222-222222222222",
  slug: "demo-hostel",
  name: "Demo Hostel",
  status: "ACTIVE",
};
const CLOSED: SwitchableTenant = {
  id: "33333333-3333-3333-3333-333333333333",
  slug: "gone-mess",
  name: "Gone Mess",
  status: "CANCELLED",
};

const ALL = [CAMPUS, DEMO, CLOSED];

function ctx(role: UserRole, tenantId = CAMPUS.id): TenantContext {
  return {
    tenantId,
    tenantSlug: "campus-crave",
    timezone: "Asia/Kolkata",
    actorProfileId: "actor-1",
    role,
  };
}

describe("canSwitchTenant", () => {
  it("admits only the super admin", () => {
    expect(canSwitchTenant("SUPER_ADMIN")).toBe(true);
  });

  it("refuses every other role, a mess admin included", () => {
    for (const role of ["ADMIN", "STAFF", "STUDENT"] as const) {
      expect(canSwitchTenant(role)).toBe(false);
    }
  });
});

describe("parseTenantSwitch", () => {
  it("lets a super admin move to another active mess", () => {
    const result = parseTenantSwitch(ctx("SUPER_ADMIN"), DEMO.id, ALL);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tenant.slug).toBe("demo-hostel");
      expect(result.value.alreadyActive).toBe(false);
    }
  });

  it("refuses a mess admin, who must never reach another hostel", () => {
    const result = parseTenantSwitch(ctx("ADMIN"), DEMO.id, ALL);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
  });

  it("refuses staff and students outright", () => {
    for (const role of ["STAFF", "STUDENT"] as const) {
      const result = parseTenantSwitch(ctx(role), DEMO.id, ALL);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
    }
  });

  it("refuses a tenant id that is not in the offered list", () => {
    const result = parseTenantSwitch(
      ctx("SUPER_ADMIN"),
      "99999999-9999-9999-9999-999999999999",
      ALL,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });

  it("refuses a blank target rather than guessing", () => {
    const result = parseTenantSwitch(ctx("SUPER_ADMIN"), "   ", ALL);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("refuses a mess that is not ACTIVE — fail closed (rule 7)", () => {
    const result = parseTenantSwitch(ctx("SUPER_ADMIN"), CLOSED.id, ALL);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TENANT_SUSPENDED");
  });

  it("treats switching to the mess already open as a no-op, not an error (rule 5)", () => {
    const result = parseTenantSwitch(ctx("SUPER_ADMIN", CAMPUS.id), CAMPUS.id, ALL);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.alreadyActive).toBe(true);
  });

  it("refuses everything when no mess is on offer", () => {
    const result = parseTenantSwitch(ctx("SUPER_ADMIN"), DEMO.id, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });
});
