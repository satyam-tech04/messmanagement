/**
 * The use case behind the mess switcher.
 *
 * The assertions that matter here are the ones about what is NOT written: a
 * refused switch must leave the operator's profile untouched, because the write
 * it performs is the only one in the system that moves a row between tenants.
 */
import { describe, it, expect } from "vitest";
import { switchOperatorTenant } from "@/core/services/switch-tenant";
import type { SwitchableTenant } from "@/core/policies/tenant-switch.policy";
import type { TenantDirectory } from "@/core/ports/repositories";
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

function ctx(role: UserRole, tenantId = CAMPUS.id): TenantContext {
  return {
    tenantId,
    tenantSlug: "campus-crave",
    timezone: "Asia/Kolkata",
    actorProfileId: "operator-1",
    role,
  };
}

/** Records every move so a test can assert that none happened. */
function fakeDirectory(
  tenants: readonly SwitchableTenant[] = [CAMPUS, DEMO],
  opts: { listThrows?: boolean; moveThrows?: boolean } = {},
) {
  const moves: Array<{ profileId: string; tenantId: string }> = [];
  const directory: TenantDirectory = {
    async listSwitchable() {
      if (opts.listThrows) throw new Error("database unreachable");
      return [...tenants];
    },
    async moveOperator(profileId, tenantId) {
      if (opts.moveThrows) throw new Error("write failed");
      moves.push({ profileId, tenantId });
    },
  };
  return { directory, moves };
}

describe("switchOperatorTenant", () => {
  it("moves the operator's own profile to the chosen mess", async () => {
    const { directory, moves } = fakeDirectory();

    const result = await switchOperatorTenant(ctx("SUPER_ADMIN"), DEMO.id, { directory });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.tenant.slug).toBe("demo-hostel");
    expect(moves).toEqual([{ profileId: "operator-1", tenantId: DEMO.id }]);
  });

  it("moves the profile named by the session, never one supplied by the caller", async () => {
    const { directory, moves } = fakeDirectory();

    await switchOperatorTenant(ctx("SUPER_ADMIN"), DEMO.id, { directory });

    expect(moves[0]!.profileId).toBe("operator-1");
  });

  it("writes nothing when a mess admin tries to switch", async () => {
    const { directory, moves } = fakeDirectory();

    const result = await switchOperatorTenant(ctx("ADMIN"), DEMO.id, { directory });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
    expect(moves).toEqual([]);
  });

  it("refuses a non-operator without reading the mess list at all", async () => {
    // Listing first would let a mess admin enumerate the platform's customers
    // through the error they get back.
    let listed = false;
    const directory: TenantDirectory = {
      async listSwitchable() {
        listed = true;
        return [CAMPUS, DEMO];
      },
      async moveOperator() {},
    };

    await switchOperatorTenant(ctx("STAFF"), DEMO.id, { directory });

    expect(listed).toBe(false);
  });

  it("writes nothing for a mess that is not on the list", async () => {
    const { directory, moves } = fakeDirectory();

    const result = await switchOperatorTenant(
      ctx("SUPER_ADMIN"),
      "99999999-9999-9999-9999-999999999999",
      { directory },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    expect(moves).toEqual([]);
  });

  it("writes nothing when switching to the mess already open (rule 5)", async () => {
    const { directory, moves } = fakeDirectory();

    const result = await switchOperatorTenant(ctx("SUPER_ADMIN", CAMPUS.id), CAMPUS.id, {
      directory,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.alreadyActive).toBe(true);
    expect(moves).toEqual([]);
  });

  it("leaves the operator where they were when the mess list cannot be read", async () => {
    const { directory, moves } = fakeDirectory([CAMPUS, DEMO], { listThrows: true });

    const result = await switchOperatorTenant(ctx("SUPER_ADMIN"), DEMO.id, { directory });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INFRASTRUCTURE_ERROR");
    expect(moves).toEqual([]);
  });

  it("reports a failed write as a failure rather than a silent success", async () => {
    const { directory } = fakeDirectory([CAMPUS, DEMO], { moveThrows: true });

    const result = await switchOperatorTenant(ctx("SUPER_ADMIN"), DEMO.id, { directory });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INFRASTRUCTURE_ERROR");
  });

  it("refuses a suspended mess, which would strand the operator with no session", async () => {
    const suspended: SwitchableTenant = { ...DEMO, status: "SUSPENDED" };
    const { directory, moves } = fakeDirectory([CAMPUS, suspended]);

    const result = await switchOperatorTenant(ctx("SUPER_ADMIN"), suspended.id, { directory });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TENANT_SUSPENDED");
    expect(moves).toEqual([]);
  });
});
