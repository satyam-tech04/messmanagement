import { describe, it, expect } from "vitest";

/**
 * The shape rule alone, copied from identity.ts. Lets the reserved-word tests
 * prove that `superuser` is refused *because it is reserved*, not because it
 * happens to fail the character rule — which it does not.
 */
const ROLL_NUMBER_SHAPE_ONLY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
import {
  classifyLoginIdentifier,
  InvalidRollNumberError,
  isReservedRollNumber,
  isSyntheticEmail,
  isValidRollNumber,
  SUPER_USER_EMAIL,
  normalizeRollNumber,
  syntheticEmailFor,
} from "@/core/domain/identity";

describe("roll number validation", () => {
  it("accepts realistic roll numbers", () => {
    for (const roll of ["CS21B001", "cs21b001", "21-CSE-042", "2021.CS.7", "B_12345", "7"]) {
      expect(isValidRollNumber(roll)).toBe(true);
    }
  });

  it("tolerates surrounding whitespace", () => {
    expect(isValidRollNumber("  CS21B001  ")).toBe(true);
  });

  it("rejects anything unsafe in an email local-part", () => {
    for (const roll of [
      "",
      "  ",
      "cs21b001@x", // an @ would produce a malformed address
      "cs 21 b001", // spaces
      "cs21/b001",
      "cs21+b001",
      "../etc/passwd",
      "-leading-hyphen", // must start alphanumeric
      ".leading-dot",
      "a".repeat(64), // too long
    ]) {
      expect(isValidRollNumber(roll)).toBe(false);
    }
  });
});

describe("normalizeRollNumber", () => {
  it("lower-cases and trims to match the lower(roll_number) index", () => {
    expect(normalizeRollNumber("  CS21B001 ")).toBe("cs21b001");
  });

  it("is idempotent", () => {
    const once = normalizeRollNumber("CS21B001");
    expect(normalizeRollNumber(once)).toBe(once);
  });
});

describe("syntheticEmailFor", () => {
  it("derives a deterministic address from tenant slug and roll number", () => {
    expect(syntheticEmailFor("unversity-mess", "CS21B001")).toBe(
      "cs21b001@unversity-mess.mess.invalid",
    );
  });

  it("is case-insensitive on the roll number", () => {
    expect(syntheticEmailFor("unversity-mess", "CS21B001")).toBe(
      syntheticEmailFor("unversity-mess", "cs21b001"),
    );
  });

  it("keeps different tenants separate for the same roll number", () => {
    // Roll numbers are unique per tenant, not globally. Two hostels can both
    // have a CS21B001 and they must never collide into one login.
    expect(syntheticEmailFor("hostel-a", "CS21B001")).not.toBe(
      syntheticEmailFor("hostel-b", "CS21B001"),
    );
  });

  it("uses the reserved .invalid TLD so the address can never receive mail", () => {
    expect(syntheticEmailFor("unversity-mess", "CS21B001")).toMatch(/\.invalid$/);
  });

  it("throws rather than mangling an unusable roll number", () => {
    // Silently sanitising would create an account nobody could ever log into,
    // and it would only be discovered with the student at the counter.
    expect(() => syntheticEmailFor("unversity-mess", "cs 21 b001")).toThrow(InvalidRollNumberError);
    expect(() => syntheticEmailFor("unversity-mess", "")).toThrow(InvalidRollNumberError);
  });

  it("produces exactly one @", () => {
    const email = syntheticEmailFor("unversity-mess", "CS21B001");
    expect(email.split("@")).toHaveLength(2);
  });
});

describe("isSyntheticEmail", () => {
  it("recognises addresses it minted", () => {
    expect(isSyntheticEmail(syntheticEmailFor("unversity-mess", "CS21B001"))).toBe(true);
  });

  it("does not mistake a real address for a synthetic one", () => {
    expect(isSyntheticEmail("warden@hostel.example.com")).toBe(false);
    expect(isSyntheticEmail("someone@gmail.com")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isSyntheticEmail("CS21B001@UNVERSITY-MESS.MESS.INVALID")).toBe(true);
  });
});

describe("classifyLoginIdentifier", () => {
  it("treats anything containing @ as an email", () => {
    expect(classifyLoginIdentifier("warden@hostel.example.com")).toEqual({
      kind: "EMAIL",
      email: "warden@hostel.example.com",
    });
  });

  it("lower-cases emails", () => {
    expect(classifyLoginIdentifier("Warden@Hostel.Example.COM")).toEqual({
      kind: "EMAIL",
      email: "warden@hostel.example.com",
    });
  });

  it("treats anything else as a roll number, normalised", () => {
    expect(classifyLoginIdentifier("  CS21B001 ")).toEqual({
      kind: "ROLL_NUMBER",
      rollNumber: "cs21b001",
    });
  });

  it("rejects empty or malformed input", () => {
    expect(classifyLoginIdentifier("")).toBeNull();
    expect(classifyLoginIdentifier("   ")).toBeNull();
    expect(classifyLoginIdentifier("cs 21 b001")).toBeNull();
  });
});

describe("the reserved operator login", () => {
  it("resolves the bare word to the operator address, not a roll number", () => {
    const result = classifyLoginIdentifier("superuser");
    expect(result).toEqual({ kind: "EMAIL", email: SUPER_USER_EMAIL });
  });

  it("is case- and whitespace-insensitive, because it is typed by hand", () => {
    for (const typed of ["SuperUser", "  SUPERUSER ", "superuser"]) {
      expect(classifyLoginIdentifier(typed)).toEqual({ kind: "EMAIL", email: SUPER_USER_EMAIL });
    }
  });

  it("does not swallow roll numbers that merely resemble it", () => {
    for (const roll of ["superuser1", "super-user", "supersuser"]) {
      expect(classifyLoginIdentifier(roll)).toEqual({
        kind: "ROLL_NUMBER",
        rollNumber: roll.toLowerCase(),
      });
    }
  });

  it("is a reserved roll number, so no student can shadow the operator login", () => {
    expect(isReservedRollNumber("superuser")).toBe(true);
    expect(isReservedRollNumber("  SuperUser  ")).toBe(true);
    expect(isReservedRollNumber("cs21b001")).toBe(false);
  });

  it("keeps the operator address off the deliverable-mail path", () => {
    // It must not be mistaken for a generated student address either.
    expect(isSyntheticEmail(SUPER_USER_EMAIL)).toBe(false);
  });
});

describe("the reserved word cannot become a student", () => {
  it("is rejected as a roll number at the one gate every creation path uses", () => {
    // Shape-legal — letters only — so nothing but the reserved check stops it.
    expect(ROLL_NUMBER_SHAPE_ONLY.test("superuser")).toBe(true);
    expect(isValidRollNumber("superuser")).toBe(false);
    expect(isValidRollNumber("  SuperUser  ")).toBe(false);
  });

  it("cannot be minted into a student login address", () => {
    expect(() => syntheticEmailFor("campus-crave", "superuser")).toThrow(InvalidRollNumberError);
  });

  it("leaves every ordinary roll number untouched", () => {
    for (const roll of ["CS21B001", "superuser1", "super-user", "7"]) {
      expect(isValidRollNumber(roll)).toBe(true);
    }
  });
});
