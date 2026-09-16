/**
 * An admin creating a counter-staff login.
 *
 * Until now staff accounts existed only where a provisioning script had put
 * them, so a mess that hired somebody had to come back to us. The rules here are
 * the ones that decide whether the account they create can actually be used:
 *
 *   - Staff sign in with a **real email address**. Students sign in with a roll
 *     number resolved to a synthetic `.invalid` address that can never receive
 *     mail; a staff account on one of those could never be recovered, and would
 *     sit in the same namespace as the students'.
 *   - Only an admin may create one. Staff verifying attendance must not be able
 *     to mint another counter login.
 */
import { describe, expect, it } from "vitest";
import { UserRole } from "@/core/domain/enums";
import { parseStaffInvite } from "@/core/policies/staff-admin.policy";

const valid = {
  actorRole: UserRole.ADMIN,
  fullName: "Roshni Patil",
  email: "roshni@campuscrave.com",
  phone: "9876543210",
};

describe("parseStaffInvite — who may create a staff login", () => {
  it("allows an admin", () => {
    expect(parseStaffInvite(valid).ok).toBe(true);
  });

  it("allows a super admin", () => {
    expect(parseStaffInvite({ ...valid, actorRole: UserRole.SUPER_ADMIN }).ok).toBe(true);
  });

  it("refuses staff — a counter login must not be able to mint another", () => {
    const r = parseStaffInvite({ ...valid, actorRole: UserRole.STAFF });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });

  it("refuses a student", () => {
    expect(parseStaffInvite({ ...valid, actorRole: UserRole.STUDENT }).ok).toBe(false);
  });
});

describe("parseStaffInvite — the details", () => {
  it("keeps the name as typed, trimmed", () => {
    const r = parseStaffInvite({ ...valid, fullName: "  Roshni Patil  " });
    expect(r.ok && r.value.fullName).toBe("Roshni Patil");
  });

  it("refuses a name too short to be one", () => {
    const r = parseStaffInvite({ ...valid, fullName: "R" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION_FAILED");
  });

  it("refuses a name nobody could have typed deliberately", () => {
    expect(parseStaffInvite({ ...valid, fullName: "x".repeat(121) }).ok).toBe(false);
  });

  it("lower-cases the email, so one person cannot be two logins", () => {
    const r = parseStaffInvite({ ...valid, email: "  Roshni@CampusCrave.com " });
    expect(r.ok && r.value.email).toBe("roshni@campuscrave.com");
  });

  it("refuses an address that is not an email", () => {
    for (const email of ["", "roshni", "roshni@", "@campuscrave.com", "a b@c.com"]) {
      expect(parseStaffInvite({ ...valid, email }).ok).toBe(false);
    }
  });

  it("refuses a synthetic student address — it can never receive mail", () => {
    // Those are derived from roll numbers and are unreachable by design, so a
    // staff member on one could never recover their own account.
    const r = parseStaffInvite({ ...valid, email: "cs21b001@campus-crave.mess.invalid" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/real email/i);
  });

  it("keeps a phone number when given, and treats blank as none", () => {
    const given = parseStaffInvite(valid);
    expect(given.ok && given.value.phone).toBe("9876543210");
    const blank = parseStaffInvite({ ...valid, phone: "   " });
    expect(blank.ok && blank.value.phone).toBeNull();
    const absent = parseStaffInvite({ ...valid, phone: undefined });
    expect(absent.ok && absent.value.phone).toBeNull();
  });

  it("refuses a phone number that is not one", () => {
    expect(parseStaffInvite({ ...valid, phone: "98765" }).ok).toBe(false);
    expect(parseStaffInvite({ ...valid, phone: "not-a-number" }).ok).toBe(false);
  });
});
