import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { hmacTokenSigner } from "@/infra/crypto/hmac-signer";
import { issueToken, verifyToken } from "@/core/policies/qr.policy";
import type { TenantSettings } from "@/core/domain/tenant-context";
import { toWallClockTime, serviceDateOf } from "@/core/time";
import { isErr, isOk, unwrap } from "@/core/result";
import { tenantSettings } from "../fakes";

const SECRET = "a-tenant-signing-secret-of-at-least-32-chars";
const OTHER_SECRET = "a-completely-different-secret-of-32-plus-chars";

describe("hmacTokenSigner", () => {
  it("produces a stable, URL-safe signature", () => {
    const a = hmacTokenSigner.sign("payload", SECRET);
    const b = hmacTokenSigner.sign("payload", SECRET);
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/); // base64url: no +, /, or =
  });

  it("matches a reference HMAC-SHA256 computation", () => {
    // Guards against a future refactor silently changing the algorithm, which
    // would invalidate every outstanding token without any test failing.
    const expected = createHmac("sha256", SECRET).update("payload", "utf8").digest("base64url");
    expect(hmacTokenSigner.sign("payload", SECRET)).toBe(expected);
  });

  it("verifies its own signature", () => {
    const sig = hmacTokenSigner.sign("payload", SECRET);
    expect(hmacTokenSigner.verify("payload", sig, SECRET)).toBe(true);
  });

  it("rejects a signature made with a different secret", () => {
    const sig = hmacTokenSigner.sign("payload", OTHER_SECRET);
    expect(hmacTokenSigner.verify("payload", sig, SECRET)).toBe(false);
  });

  it("rejects a signature over different content", () => {
    const sig = hmacTokenSigner.sign("payload", SECRET);
    expect(hmacTokenSigner.verify("payload-tampered", sig, SECRET)).toBe(false);
  });

  it("rejects a single flipped character", () => {
    const sig = hmacTokenSigner.sign("payload", SECRET);
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(hmacTokenSigner.verify("payload", flipped, SECRET)).toBe(false);
  });

  it("returns false rather than throwing on a wrong-length signature", () => {
    // timingSafeEqual throws on length mismatch; that must never surface as a
    // 500 at the counter, and it must not leak through the exception path.
    expect(() => hmacTokenSigner.verify("payload", "", SECRET)).not.toThrow();
    expect(hmacTokenSigner.verify("payload", "", SECRET)).toBe(false);
    expect(hmacTokenSigner.verify("payload", "short", SECRET)).toBe(false);
    expect(hmacTokenSigner.verify("payload", "x".repeat(500), SECRET)).toBe(false);
  });

  it("handles multi-byte payloads", () => {
    const payload = "मेस — ₹4,000";
    const sig = hmacTokenSigner.sign(payload, SECRET);
    expect(hmacTokenSigner.verify(payload, sig, SECRET)).toBe(true);
  });

  it("uses constant-time comparison, not ===", () => {
    // Asserting timing empirically is flaky, so assert on the source instead:
    // the module must call timingSafeEqual and must not compare the computed
    // signature with a short-circuiting equality operator.
    const source = readFileSync("src/infra/crypto/hmac-signer.ts", "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, ""); // strip comments
    expect(code).toContain("timingSafeEqual");
    expect(code).not.toMatch(/expected\s*===\s*signature|signature\s*===\s*expected/);
  });
});

describe("hmacTokenSigner wired into the real QR policy", () => {
  const settings: TenantSettings = tenantSettings({
    tenantId: "tenant-a",
    mealSlots: [{ slot: "LUNCH", start: toWallClockTime("12:00"), end: toWallClockTime("14:30") }],
    qrTokenTtlSeconds: 30,
    qrRefreshSeconds: 15,
  });
  const IST = "Asia/Kolkata";
  const DURING_LUNCH = new Date("2026-07-15T07:30:00Z"); // 13:00 IST

  const mint = (secret = SECRET, tenantId = "tenant-a") =>
    unwrap(
      issueToken({
        tenantId,
        studentId: "student-1",
        mealSlot: "LUNCH",
        serviceDate: serviceDateOf(IST, DURING_LUNCH),
        settings,
        now: DURING_LUNCH,
        timezone: IST,
        secret,
        nonce: "n1",
        signer: hmacTokenSigner,
      }),
    ).token;

  it("round-trips a real token end to end", () => {
    const result = verifyToken({
      token: mint(),
      expectedTenantId: "tenant-a",
      settings,
      timezone: IST,
      secret: SECRET,
      now: DURING_LUNCH,
      signer: hmacTokenSigner,
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.studentId).toBe("student-1");
  });

  it("rejects a token signed with another tenant's secret", () => {
    const result = verifyToken({
      token: mint(OTHER_SECRET),
      expectedTenantId: "tenant-a",
      settings,
      timezone: IST,
      secret: SECRET,
      now: DURING_LUNCH,
      signer: hmacTokenSigner,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("INVALID_TOKEN");
  });

  it("rejects a payload swapped after signing", () => {
    const token = mint();
    const [, signature] = token.split(".");
    const forgedPayload = unwrap(
      issueToken({
        tenantId: "tenant-a",
        studentId: "someone-else",
        mealSlot: "LUNCH",
        serviceDate: serviceDateOf(IST, DURING_LUNCH),
        settings,
        now: DURING_LUNCH,
        timezone: IST,
        secret: SECRET,
        nonce: "n2",
        signer: hmacTokenSigner,
      }),
    ).token.split(".")[0];

    const result = verifyToken({
      token: `${forgedPayload}.${signature}`,
      expectedTenantId: "tenant-a",
      settings,
      timezone: IST,
      secret: SECRET,
      now: DURING_LUNCH,
      signer: hmacTokenSigner,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("INVALID_TOKEN");
  });
});
