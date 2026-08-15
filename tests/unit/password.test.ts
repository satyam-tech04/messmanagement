/**
 * Tests for temporary passwords.
 *
 * On import, a student's initial password is their own mobile number. That is a
 * deliberate trade: several hundred students cannot each be handed a random
 * password, and a number they already know needs no distribution at all — one
 * broadcast message onboards the whole hostel.
 *
 * What makes it safe is that `must_change_password` is forced, so the guessable
 * password only exists between the import and that student's first login. What
 * makes it *work* is that the derivation must produce exactly the digits the
 * student will type, whatever shape the office typed into the spreadsheet.
 * `+91 98765 43210` and `9876543210` are the same person and the same password.
 */
import { describe, expect, it } from "vitest";
import { generateTemporaryPassword, temporaryPasswordFromPhone } from "@/lib/password";

describe("temporaryPasswordFromPhone", () => {
  it("uses a plain ten-digit number as typed", () => {
    expect(temporaryPasswordFromPhone("9876543210")).toBe("9876543210");
  });

  it("strips a +91 country code, because the student types ten digits", () => {
    expect(temporaryPasswordFromPhone("+919876543210")).toBe("9876543210");
  });

  it("strips spaces and punctuation the office may have typed", () => {
    expect(temporaryPasswordFromPhone("+91 98765-43210")).toBe("9876543210");
    expect(temporaryPasswordFromPhone("(098) 765 43210")).toBe("9876543210");
  });

  it("drops a leading zero by taking the last ten digits", () => {
    expect(temporaryPasswordFromPhone("09876543210")).toBe("9876543210");
  });

  it("gives the same answer for every way of writing one number", () => {
    // The whole scheme collapses if two spellings of a student's number produce
    // two different passwords — they would be told one and need the other.
    const forms = ["9876543210", "+919876543210", "+91 9876543210", "091-98765-43210"];
    const derived = forms.map(temporaryPasswordFromPhone);
    expect(new Set(derived).size).toBe(1);
  });

  it("refuses a number too short to be a mobile", () => {
    // Falling back to a generated password is right here: a five-digit password
    // would be rejected by Supabase anyway, and silently truncating would tell
    // the student something that does not work.
    expect(temporaryPasswordFromPhone("98765")).toBeNull();
  });

  it("refuses an empty or missing value", () => {
    expect(temporaryPasswordFromPhone("")).toBeNull();
    expect(temporaryPasswordFromPhone(undefined)).toBeNull();
    expect(temporaryPasswordFromPhone("   ")).toBeNull();
  });

  it("refuses a value with no digits at all", () => {
    expect(temporaryPasswordFromPhone("not a phone")).toBeNull();
  });

  it("is long enough for the auth provider's minimum", () => {
    // Supabase rejects passwords under six characters, and a rejected create
    // would fail mid-import.
    expect(temporaryPasswordFromPhone("9876543210")!.length).toBeGreaterThanOrEqual(6);
  });

  it("returns only digits, so it can be dictated without ambiguity", () => {
    expect(temporaryPasswordFromPhone("+91 98765 43210")).toMatch(/^\d{10}$/);
  });
});

describe("generateTemporaryPassword — still used where there is no phone", () => {
  it("produces a different password each time", () => {
    const seen = new Set(Array.from({ length: 50 }, generateTemporaryPassword));
    expect(seen.size).toBe(50);
  });

  it("avoids characters that are misread when dictated", () => {
    // O/0, l/1/I and S/5 are a support call each when read down a phone line.
    for (let i = 0; i < 50; i++) {
      expect(generateTemporaryPassword()).not.toMatch(/[0O1lI5S]/);
    }
  });

  it("is grouped for reading aloud", () => {
    expect(generateTemporaryPassword()).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
  });
});
