/**
 * Who may use the website, and how the platform operator enters a mess as a
 * student.
 *
 * Impersonation is the second place in the product where one person acts as
 * another, so most of these cases are about who is refused — a mess admin who
 * could enter a student's account could generate that student's meal QR.
 */
import { describe, it, expect } from "vitest";
import {
  IMPERSONATION_TTL_SECONDS,
  OPERATOR_PERSONAS,
  canSignInOnWeb,
  encodeImpersonationMarker,
  parseImpersonationTarget,
  readImpersonationMarker,
  type ImpersonationCandidate,
  type ImpersonationMarker,
} from "@/core/policies/operator-access.policy";
import type { TenantContext } from "@/core/domain/tenant-context";
import type { UserRole } from "@/core/domain/enums";
import type { TokenSigner } from "@/core/ports/token-signer";

const CAMPUS = "11111111-1111-1111-1111-111111111111";
const DEMO = "22222222-2222-2222-2222-222222222222";

function ctx(role: UserRole, tenantId = DEMO): TenantContext {
  return {
    tenantId,
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

/** Deterministic and obviously not crypto — the policy must not care which. */
const fakeSigner: TokenSigner = {
  sign: (payload, secret) => `sig(${secret}:${payload.length}:${payload.slice(0, 12)})`,
  verify: (payload, signature, secret) =>
    signature === `sig(${secret}:${payload.length}:${payload.slice(0, 12)})`,
};

const SECRET = "s".repeat(32);
const NOW = new Date("2026-09-15T10:00:00Z");

describe("canSignInOnWeb", () => {
  it("admits every role while the app-only switch is off", () => {
    for (const role of ["STUDENT", "STAFF", "ADMIN", "SUPER_ADMIN"] as const) {
      expect(canSignInOnWeb(role, { appOnly: false })).toBe(true);
    }
  });

  it("admits only admins and the operator once the switch is on", () => {
    expect(canSignInOnWeb("ADMIN", { appOnly: true })).toBe(true);
    expect(canSignInOnWeb("SUPER_ADMIN", { appOnly: true })).toBe(true);
  });

  it("refuses students and counter staff once the switch is on", () => {
    expect(canSignInOnWeb("STUDENT", { appOnly: true })).toBe(false);
    expect(canSignInOnWeb("STAFF", { appOnly: true })).toBe(false);
  });
});

describe("OPERATOR_PERSONAS", () => {
  it("offers exactly admin, staff and student, in that order", () => {
    expect(OPERATOR_PERSONAS.map((p) => p.persona)).toEqual(["ADMIN", "STAFF", "STUDENT"]);
  });

  it("sends the student persona to the picker, never straight into a student shell", () => {
    // The operator has no student record of their own; /student would render
    // an empty account rather than any real student's day.
    const student = OPERATOR_PERSONAS.find((p) => p.persona === "STUDENT")!;
    expect(student.href).toBe("/superuser/students");
  });

  it("routes admin and staff to their existing shells", () => {
    expect(OPERATOR_PERSONAS.find((p) => p.persona === "ADMIN")!.href).toBe("/admin");
    expect(OPERATOR_PERSONAS.find((p) => p.persona === "STAFF")!.href).toBe("/staff");
  });
});

describe("parseImpersonationTarget", () => {
  it("accepts an active student in the operator's current mess", () => {
    const result = parseImpersonationTarget(ctx("SUPER_ADMIN"), "student-profile-1", STUDENT);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.profileId).toBe("student-profile-1");
  });

  it("refuses a mess admin, even for a student in their own mess", () => {
    const result = parseImpersonationTarget(ctx("ADMIN"), "student-profile-1", STUDENT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
  });

  it("refuses staff and students outright", () => {
    for (const role of ["STAFF", "STUDENT"] as const) {
      const result = parseImpersonationTarget(ctx(role), "student-profile-1", STUDENT);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
    }
  });

  it("refuses a blank target id", () => {
    const result = parseImpersonationTarget(ctx("SUPER_ADMIN"), "   ", STUDENT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("refuses when the account could not be found", () => {
    const result = parseImpersonationTarget(ctx("SUPER_ADMIN"), "student-profile-1", null);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });

  it("refuses when the looked-up account is not the one asked for", () => {
    const result = parseImpersonationTarget(ctx("SUPER_ADMIN"), "someone-else", STUDENT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });

  it("answers NOT_FOUND for a student in another mess, so other messes stay invisible", () => {
    const result = parseImpersonationTarget(ctx("SUPER_ADMIN", CAMPUS), "student-profile-1", {
      ...STUDENT,
      tenantId: DEMO,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });

  it("refuses to enter an admin or staff account — only students", () => {
    for (const role of ["ADMIN", "STAFF", "SUPER_ADMIN"] as const) {
      const result = parseImpersonationTarget(ctx("SUPER_ADMIN"), "student-profile-1", {
        ...STUDENT,
        role,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
    }
  });

  it("refuses a disabled account, which the session layer would reject anyway", () => {
    const result = parseImpersonationTarget(ctx("SUPER_ADMIN"), "student-profile-1", {
      ...STUDENT,
      profileStatus: "DISABLED",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
  });
});

describe("impersonation marker", () => {
  const marker: ImpersonationMarker = {
    operatorProfileId: "operator-1",
    studentProfileId: "student-profile-1",
    tenantId: DEMO,
    expiresAt: new Date(NOW.getTime() + IMPERSONATION_TTL_SECONDS * 1000).toISOString(),
  };

  function read(
    raw: string | undefined,
    overrides: Partial<Parameters<typeof readImpersonationMarker>[1]> = {},
  ) {
    return readImpersonationMarker(raw, {
      signer: fakeSigner,
      secret: SECRET,
      now: NOW,
      sessionProfileId: "student-profile-1",
      ...overrides,
    });
  }

  it("round-trips through encode and read", () => {
    const raw = encodeImpersonationMarker(marker, fakeSigner, SECRET);

    expect(read(raw)).toEqual(marker);
  });

  it("lasts two hours, long enough to reproduce a problem and short enough to be forgotten safely", () => {
    expect(IMPERSONATION_TTL_SECONDS).toBe(2 * 60 * 60);
  });

  it("reads nothing when there is no cookie", () => {
    expect(read(undefined)).toBeNull();
    expect(read("")).toBeNull();
  });

  it("rejects a value with no signature", () => {
    const raw = encodeImpersonationMarker(marker, fakeSigner, SECRET);
    expect(read(raw.split(".")[0])).toBeNull();
  });

  it("rejects a forged payload carrying a copied signature", () => {
    // A student who could mint this would skip their forced password change
    // and hide behind the operator banner.
    const raw = encodeImpersonationMarker(marker, fakeSigner, SECRET);
    const [, signature] = raw.split(".");
    const forged = encodeImpersonationMarker(
      { ...marker, operatorProfileId: "student-profile-1-and-more" },
      fakeSigner,
      SECRET,
    ).split(".")[0];

    expect(read(`${forged}.${signature}`)).toBeNull();
  });

  it("rejects a marker signed with a different secret", () => {
    const raw = encodeImpersonationMarker(marker, fakeSigner, "x".repeat(32));
    expect(read(raw)).toBeNull();
  });

  it("rejects garbage that is not base64 JSON", () => {
    expect(read("not-base64!!.sig")).toBeNull();
    const junk = btoa("[1,2,3]").replace(/=+$/, "");
    expect(read(`${junk}.${fakeSigner.sign(junk, SECRET)}`)).toBeNull();
  });

  it("rejects a correctly signed payload that is not valid base64", () => {
    // Signature checks first, so this proves the decoder itself fails closed
    // rather than throwing out of the layout.
    const payload = "%%%%";
    expect(read(`${payload}.${fakeSigner.sign(payload, SECRET)}`)).toBeNull();
  });

  it("rejects a correctly signed payload that is not JSON", () => {
    const payload = btoa("{not json").replace(/=+$/, "");
    expect(read(`${payload}.${fakeSigner.sign(payload, SECRET)}`)).toBeNull();
  });

  it("rejects a payload missing a field", () => {
    const partial = btoa(JSON.stringify({ operatorProfileId: "operator-1" })).replace(/=+$/, "");
    expect(read(`${partial}.${fakeSigner.sign(partial, SECRET)}`)).toBeNull();
  });

  it("rejects an expired marker", () => {
    const raw = encodeImpersonationMarker(marker, fakeSigner, SECRET);
    expect(read(raw, { now: new Date(marker.expiresAt) })).toBeNull();
  });

  it("rejects a marker with an unreadable expiry", () => {
    const raw = encodeImpersonationMarker({ ...marker, expiresAt: "soon" }, fakeSigner, SECRET);
    expect(read(raw)).toBeNull();
  });

  it("rejects a marker belonging to a different session", () => {
    // The cookie outlives a sign-out on a shared counter laptop. The next
    // student to sign in there must not inherit the operator's exemptions.
    const raw = encodeImpersonationMarker(marker, fakeSigner, SECRET);
    expect(read(raw, { sessionProfileId: "student-profile-2" })).toBeNull();
  });
});
