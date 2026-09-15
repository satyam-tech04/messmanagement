/**
 * The use case behind "Enter as this student".
 *
 * The lookup it performs reads an account across the service-role boundary, so
 * the assertions that matter are about when that lookup is NOT made.
 */
import { describe, it, expect } from "vitest";
import { beginStudentImpersonation } from "@/core/services/begin-impersonation";
import type { ImpersonationCandidate } from "@/core/policies/operator-access.policy";
import type { ImpersonationDirectory } from "@/core/ports/repositories";
import type { TenantContext } from "@/core/domain/tenant-context";
import type { UserRole } from "@/core/domain/enums";

const DEMO = "22222222-2222-2222-2222-222222222222";

function ctx(role: UserRole): TenantContext {
  return {
    tenantId: DEMO,
    tenantSlug: "demo-hostel",
    timezone: "Asia/Kolkata",
    actorProfileId: "operator-1",
    role,
  };
}

const STUDENT: ImpersonationCandidate = {
  profileId: "student-profile-1",
  tenantId: DEMO,
  role: "STUDENT",
  profileStatus: "ACTIVE",
  fullName: "Asha Rao",
  rollNumber: "7",
};

function fakeDirectory(opts: { candidate?: ImpersonationCandidate | null; throws?: boolean } = {}) {
  const lookups: Array<{ tenantId: string; profileId: string }> = [];
  const directory: ImpersonationDirectory = {
    async findStudentAccount(tenantId, profileId) {
      lookups.push({ tenantId, profileId });
      if (opts.throws) throw new Error("database unreachable");
      return opts.candidate === undefined ? STUDENT : opts.candidate;
    },
  };
  return { directory, lookups };
}

describe("beginStudentImpersonation", () => {
  it("returns the student when the operator may enter the account", async () => {
    const { directory } = fakeDirectory();

    const result = await beginStudentImpersonation(ctx("SUPER_ADMIN"), "student-profile-1", {
      directory,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.fullName).toBe("Asha Rao");
  });

  it("looks the student up in the operator's current mess, never one named by the caller", async () => {
    const { directory, lookups } = fakeDirectory();

    await beginStudentImpersonation(ctx("SUPER_ADMIN"), "student-profile-1", { directory });

    expect(lookups).toEqual([{ tenantId: DEMO, profileId: "student-profile-1" }]);
  });

  it("refuses a mess admin without looking anyone up", async () => {
    // Looking up first would let an admin learn which ids are accounts.
    const { directory, lookups } = fakeDirectory();

    const result = await beginStudentImpersonation(ctx("ADMIN"), "student-profile-1", {
      directory,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
    expect(lookups).toEqual([]);
  });

  it("fails closed when the account cannot be read", async () => {
    const { directory } = fakeDirectory({ throws: true });

    const result = await beginStudentImpersonation(ctx("SUPER_ADMIN"), "student-profile-1", {
      directory,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INFRASTRUCTURE_ERROR");
  });

  it("passes the policy's refusal through unchanged", async () => {
    const { directory } = fakeDirectory({ candidate: null });

    const result = await beginStudentImpersonation(ctx("SUPER_ADMIN"), "student-profile-1", {
      directory,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });
});
