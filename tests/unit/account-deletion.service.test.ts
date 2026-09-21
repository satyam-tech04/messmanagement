/**
 * Requesting, cancelling and completing an account deletion.
 *
 * The policy decides; these use cases own the ordering, and the ordering is
 * where this feature can hurt someone. A request that disabled a login without
 * recording the request would lock a student out with nothing to undo. An
 * erasure that anonymised the profile but left the request open would be redone
 * on the next click, against a student who no longer exists.
 */
import { describe, expect, it } from "vitest";
import {
  cancelAccountDeletion,
  completeAccountDeletion,
  requestAccountDeletion,
} from "@/core/services/account-deletion";
import type {
  AccountDeletionRepository,
  AccountHolder,
  DeletionRequestRow,
} from "@/core/ports/repositories";
import type { TenantContext } from "@/core/domain/tenant-context";
import { isErr, isOk, unwrap } from "@/core/result";

const TENANT = "11111111-1111-1111-1111-111111111111";
const PROFILE = "22222222-2222-2222-2222-222222222222";
const STUDENT = "33333333-3333-3333-3333-333333333333";
const ADMIN_PROFILE = "44444444-4444-4444-4444-444444444444";

function studentContext(): TenantContext {
  return {
    tenantId: TENANT,
    tenantSlug: "demo-hostel",
    actorProfileId: PROFILE,
    role: "STUDENT",
    studentId: STUDENT,
    timezone: "Asia/Kolkata",
  };
}

function adminContext(): TenantContext {
  return {
    tenantId: TENANT,
    tenantSlug: "demo-hostel",
    actorProfileId: ADMIN_PROFILE,
    role: "ADMIN",
    timezone: "Asia/Kolkata",
  };
}

/** An in-memory stand-in that records what the service asked it to do. */
function fakeRepository(seed?: Partial<AccountHolder>) {
  const holder: AccountHolder = {
    profileId: PROFILE,
    studentId: STUDENT,
    profileStatus: "ACTIVE",
    studentStatus: "ACTIVE",
    ...seed,
  };

  const rows: DeletionRequestRow[] = [];
  const calls = {
    access: [] as Array<{ profileStatus: string; studentStatus: string | null }>,
    erased: [] as Array<{ profileId: string; studentId: string | null; rollNumber: string }>,
  };

  const repo: AccountDeletionRepository = {
    holderOf: async () => holder,
    openRequestFor: async () => rows.find((r) => r.status === "REQUESTED") ?? null,
    byId: async (_tenantId, id) => rows.find((r) => r.id === id) ?? null,
    create: async (input) => {
      // The real table has a partial unique index; the fake enforces the same
      // invariant so a test cannot pass against behaviour the database refuses.
      if (rows.some((r) => r.status === "REQUESTED")) {
        throw Object.assign(new Error("duplicate key"), { code: "23505" });
      }
      const row: DeletionRequestRow = {
        id: `req-${rows.length + 1}`,
        tenantId: input.tenantId,
        profileId: input.profileId,
        studentId: input.studentId,
        status: "REQUESTED",
        requestedAt: "2026-09-21T06:00:00.000Z",
        eraseBy: input.eraseBy,
        previousProfileStatus: input.previousProfileStatus,
        previousStudentStatus: input.previousStudentStatus,
        decidedAt: null,
        decidedBy: null,
        note: null,
        studentName: "QA Student",
        rollNumber: "QA001",
      };
      rows.push(row);
      return row;
    },
    markDecided: async (_tenantId, id, decision) => {
      const row = rows.find((r) => r.id === id)!;
      const updated: DeletionRequestRow = {
        ...row,
        status: decision.status,
        decidedAt: "2026-09-22T06:00:00.000Z",
        decidedBy: decision.decidedBy,
        note: decision.note ?? null,
      };
      rows[rows.indexOf(row)] = updated;
      return updated;
    },
    listByTenant: async () => rows,
    setAccess: async (_tenantId, _profileId, access) => {
      calls.access.push(access);
    },
    eraseIdentity: async (_tenantId, input) => {
      calls.erased.push({
        profileId: input.profileId,
        studentId: input.studentId,
        rollNumber: input.redacted.rollNumber,
      });
    },
  };

  return { repo, rows, calls };
}

const now = () => new Date("2026-09-21T06:00:00.000Z");

describe("a student asks to be deleted", () => {
  it("records the request and revokes access in the same breath", async () => {
    const { repo, rows, calls } = fakeRepository();

    const result = await requestAccountDeletion(studentContext(), { repo, now });

    expect(isOk(result)).toBe(true);
    expect(unwrap(result).eraseBy).toBe("2026-10-21");
    expect(rows).toHaveLength(1);
    // Disabling the profile is what actually ends the session: every endpoint
    // resolves it and fails closed, so tokens already on the phone stop working.
    expect(calls.access).toEqual([{ profileStatus: "DISABLED", studentStatus: "INACTIVE" }]);
  });

  it("remembers what the student was, so a cancellation can put it back", async () => {
    const { repo, rows } = fakeRepository({ studentStatus: "BLOCKED" });

    await requestAccountDeletion(studentContext(), { repo, now });

    expect(rows[0]!.previousProfileStatus).toBe("ACTIVE");
    expect(rows[0]!.previousStudentStatus).toBe("BLOCKED");
  });

  it("is idempotent: a second tap writes nothing and reports the first deadline", async () => {
    const { repo, rows, calls } = fakeRepository();

    const first = await requestAccountDeletion(studentContext(), { repo, now });
    const second = await requestAccountDeletion(studentContext(), { repo, now });

    expect(isOk(second)).toBe(true);
    expect(rows).toHaveLength(1);
    expect(unwrap(second).eraseBy).toBe(unwrap(first).eraseBy);
    expect(unwrap(second).alreadyRequested).toBe(true);
    // And it does not disable an already-disabled profile a second time.
    expect(calls.access).toHaveLength(1);
  });

  it("refuses an admin", async () => {
    const { repo, rows } = fakeRepository();

    const result = await requestAccountDeletion(adminContext(), { repo, now });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("FORBIDDEN");
    expect(rows).toHaveLength(0);
  });
});

describe("an admin completes it", () => {
  async function openRequest() {
    const fake = fakeRepository();
    await requestAccountDeletion(studentContext(), { repo: fake.repo, now });
    return fake;
  }

  it("anonymises the student and closes the request", async () => {
    const { repo, rows, calls } = await openRequest();

    const result = await completeAccountDeletion(
      adminContext(),
      { requestId: "req-1" },
      { repo, now },
    );

    expect(isOk(result)).toBe(true);
    expect(calls.erased).toHaveLength(1);
    expect(calls.erased[0]!.rollNumber).toMatch(/^DELETED-/);
    expect(rows[0]!.status).toBe("COMPLETED");
    expect(rows[0]!.decidedBy).toBe(ADMIN_PROFILE);
  });

  it("does not erase twice", async () => {
    const { repo, calls } = await openRequest();

    await completeAccountDeletion(adminContext(), { requestId: "req-1" }, { repo, now });
    const again = await completeAccountDeletion(
      adminContext(),
      { requestId: "req-1" },
      { repo, now },
    );

    expect(isErr(again)).toBe(true);
    if (isErr(again)) expect(again.error.code).toBe("ILLEGAL_TRANSITION");
    expect(calls.erased).toHaveLength(1);
  });

  it("refuses an admin from another mess", async () => {
    const { repo, calls } = await openRequest();
    const outsider = { ...adminContext(), tenantId: "99999999-9999-9999-9999-999999999999" };

    const result = await completeAccountDeletion(outsider, { requestId: "req-1" }, { repo, now });

    expect(isErr(result)).toBe(true);
    expect(calls.erased).toHaveLength(0);
  });

  it("erases before it closes the request, so a crash leaves work to retry", async () => {
    // If the request were closed first and the erasure then failed, the student
    // would be recorded as deleted while their name was still in the database
    // and nothing would ever come back to finish the job.
    const { repo, rows } = await openRequest();
    const order: string[] = [];
    const watched: AccountDeletionRepository = {
      ...repo,
      eraseIdentity: async (...args) => {
        order.push("erase");
        return repo.eraseIdentity(...args);
      },
      markDecided: async (...args) => {
        order.push("decide");
        return repo.markDecided(...args);
      },
    };

    await completeAccountDeletion(adminContext(), { requestId: "req-1" }, { repo: watched, now });

    expect(order).toEqual(["erase", "decide"]);
    expect(rows[0]!.status).toBe("COMPLETED");
  });
});

describe("an admin cancels it", () => {
  it("puts the student back exactly as they were", async () => {
    const fake = fakeRepository({ studentStatus: "BLOCKED" });
    await requestAccountDeletion(studentContext(), { repo: fake.repo, now });

    const result = await cancelAccountDeletion(
      adminContext(),
      { requestId: "req-1", note: "Asked us by mistake" },
      { repo: fake.repo, now },
    );

    expect(isOk(result)).toBe(true);
    // Not blanket-ACTIVE: this student was BLOCKED before they asked, and
    // un-deleting them must not clear a block the mess had put on them.
    expect(fake.calls.access.at(-1)).toEqual({
      profileStatus: "ACTIVE",
      studentStatus: "BLOCKED",
    });
    expect(fake.rows[0]!.status).toBe("CANCELLED");
    expect(fake.rows[0]!.note).toBe("Asked us by mistake");
  });

  it("cannot resurrect someone already erased", async () => {
    const fake = fakeRepository();
    await requestAccountDeletion(studentContext(), { repo: fake.repo, now });
    await completeAccountDeletion(adminContext(), { requestId: "req-1" }, { repo: fake.repo, now });

    const result = await cancelAccountDeletion(
      adminContext(),
      { requestId: "req-1" },
      { repo: fake.repo, now },
    );

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("ILLEGAL_TRANSITION");
  });
});

describe("two taps race each other", () => {
  it("treats the loser of the race as a success, not an error", async () => {
    // The partial unique index is the guarantee, not an `if` in application
    // code: two requests in flight at once both pass the "is one open?" read.
    // The one that loses the insert must still tell its student they are being
    // deleted — which is true — rather than showing a database error.
    const fake = fakeRepository();
    let open: DeletionRequestRow | null = null;

    const racing: AccountDeletionRepository = {
      ...fake.repo,
      // Nothing open at the moment of the check...
      openRequestFor: async () => open,
      create: async (input) => {
        // ...but by the time the insert lands, the other tap has won.
        const row = await fake.repo.create(input);
        open = row;
        throw Object.assign(new Error("duplicate key"), { code: "23505" });
      },
    };

    const result = await requestAccountDeletion(studentContext(), { repo: racing, now });

    expect(isOk(result)).toBe(true);
    expect(unwrap(result).alreadyRequested).toBe(true);
    expect(fake.rows).toHaveLength(1);
  });

  it("reports a genuine database failure rather than claiming success", async () => {
    // A student told "your account is closing" whose request was never written
    // would wait 30 days for nothing.
    const fake = fakeRepository();
    const broken: AccountDeletionRepository = {
      ...fake.repo,
      create: async () => {
        throw new Error("connection reset");
      },
    };

    const result = await requestAccountDeletion(studentContext(), { repo: broken, now });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("INFRASTRUCTURE_ERROR");
    expect(fake.calls.access).toHaveLength(0);
  });

  it("refuses when the account cannot be found at all", async () => {
    const fake = fakeRepository();
    const missing: AccountDeletionRepository = { ...fake.repo, holderOf: async () => null };

    const result = await requestAccountDeletion(studentContext(), { repo: missing, now });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("NOT_FOUND");
  });

  it("refuses a staff member deciding someone else's deletion", async () => {
    const fake = fakeRepository();
    await requestAccountDeletion(studentContext(), { repo: fake.repo, now });
    const staff = { ...adminContext(), role: "STAFF" as const };

    const result = await completeAccountDeletion(
      staff,
      { requestId: "req-1" },
      { repo: fake.repo, now },
    );

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("FORBIDDEN");
    expect(fake.calls.erased).toHaveLength(0);
  });
});
