import { describe, it, expect } from "vitest";
import {
  base64UrlDecode,
  base64UrlEncode,
  currentMealSlot,
  issueToken,
  QR_TOKEN_VERSION,
  verifyToken,
} from "@/core/policies/qr.policy";
import type { TokenSigner } from "@/core/ports/token-signer";
import type { TenantSettings } from "@/core/domain/tenant-context";
import { toWallClockTime, serviceDateOf } from "@/core/time";
import { isErr, isOk, unwrap } from "@/core/result";

const IST = "Asia/Kolkata";
const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const STUDENT = "33333333-3333-3333-3333-333333333333";
const SECRET_A = "tenant-a-signing-secret-at-least-32-chars";
const SECRET_B = "tenant-b-signing-secret-at-least-32-chars";

/**
 * Deterministic stand-in for the HMAC adapter. Keeps these tests pure and fast
 * while still exercising the exact code path — the real signer is covered
 * separately in the infra tests.
 */
const fakeSigner: TokenSigner = {
  sign: (payload, secret) => `sig(${secret}:${payload.length}:${hash(payload + secret)})`,
  verify(payload, signature, secret) {
    return signature === this.sign(payload, secret);
  },
};

function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const settings: TenantSettings = {
  tenantId: TENANT_A,
  mealSlots: [
    { slot: "LUNCH", start: toWallClockTime("12:00"), end: toWallClockTime("14:30") },
    { slot: "DINNER", start: toWallClockTime("19:30"), end: toWallClockTime("22:00") },
  ],
  cutAdvanceHours: 12,
  cutMaxDaysPerMonth: 5,
  gracePeriodDays: 3,
  blockOnOverdue: true,
  allowExtras: false,
  guestTokenPricePaise: 0,
  extraPlatePricePaise: 0,
  qrTokenTtlSeconds: 30,
  qrRefreshSeconds: 15,
  currency: "INR",
};

// 13:00 IST on 5 July 2026 — inside the lunch window.
const DURING_LUNCH = new Date("2026-07-05T07:30:00Z");

function mint(at: Date = DURING_LUNCH, slot: "LUNCH" | "DINNER" = "LUNCH") {
  return unwrap(
    issueToken({
      tenantId: TENANT_A,
      studentId: STUDENT,
      mealSlot: slot,
      serviceDate: serviceDateOf(IST, at),
      settings,
      now: at,
      timezone: IST,
      secret: SECRET_A,
      nonce: "nonce-1",
      signer: fakeSigner,
    }),
  );
}

function check(token: string, now: Date, over: Partial<Parameters<typeof verifyToken>[0]> = {}) {
  return verifyToken({
    token,
    expectedTenantId: TENANT_A,
    settings,
    timezone: IST,
    secret: SECRET_A,
    now,
    signer: fakeSigner,
    ...over,
  });
}

describe("base64url codec", () => {
  it("round-trips payloads of every length modulo 3", () => {
    for (const s of ["a", "ab", "abc", "abcd", '{"v":1,"t":"x"}', ""]) {
      expect(base64UrlDecode(base64UrlEncode(s))).toBe(s);
    }
  });

  it("emits only URL-safe characters and no padding", () => {
    const encoded = base64UrlEncode(JSON.stringify({ v: 1, t: TENANT_A, s: STUDENT }));
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded).not.toContain("=");
  });

  it("round-trips multi-byte UTF-8", () => {
    expect(base64UrlDecode(base64UrlEncode("मेस — ₹4,000"))).toBe("मेस — ₹4,000");
  });

  it("rejects invalid characters", () => {
    expect(() => base64UrlDecode("abc!")).toThrow();
  });
});

describe("issueToken", () => {
  it("mints a signed token carrying the tenant-local service date", () => {
    const issued = mint();
    expect(issued.token).toContain(".");
    expect(issued.serviceDate).toBe("2026-07-05");
    expect(issued.refreshSeconds).toBe(15);
    expect(issued.expiresAt.getTime() - DURING_LUNCH.getTime()).toBe(30_000);

    const payload = JSON.parse(base64UrlDecode(issued.token.split(".")[0]!));
    expect(payload).toMatchObject({
      v: QR_TOKEN_VERSION,
      t: TENANT_A,
      s: STUDENT,
      m: "LUNCH",
      d: "2026-07-05",
    });
  });

  it("files a late-night token under the tenant's date, not UTC's", () => {
    // 19:00Z on 5 July = 00:30 IST on 6 July.
    const issued = mint(new Date("2026-07-05T19:00:00Z"), "DINNER");
    expect(issued.serviceDate).toBe("2026-07-06");
  });

  it("refuses a slot the tenant does not serve", () => {
    const result = issueToken({
      tenantId: TENANT_A,
      studentId: STUDENT,
      mealSlot: "BREAKFAST",
      serviceDate: serviceDateOf(IST, DURING_LUNCH),
      settings,
      now: DURING_LUNCH,
      timezone: IST,
      secret: SECRET_A,
      nonce: "n",
      signer: fakeSigner,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("SLOT_NOT_SERVED");
  });

  it("produces distinct tokens for distinct nonces", () => {
    const a = mint();
    const b = unwrap(
      issueToken({
        tenantId: TENANT_A,
        studentId: STUDENT,
        mealSlot: "LUNCH",
        serviceDate: serviceDateOf(IST, DURING_LUNCH),
        settings,
        now: DURING_LUNCH,
        timezone: IST,
        secret: SECRET_A,
        nonce: "nonce-2",
        signer: fakeSigner,
      }),
    );
    expect(a.token).not.toBe(b.token);
  });
});

describe("verifyToken — happy path", () => {
  it("accepts a fresh token scanned inside the meal window", () => {
    const result = check(mint().token, DURING_LUNCH);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.studentId).toBe(STUDENT);
      expect(result.value.mealSlot).toBe("LUNCH");
      expect(result.value.serviceDate).toBe("2026-07-05");
    }
  });

  it("accepts a token at the last instant of its TTL", () => {
    const issued = mint();
    const atExpiry = new Date(DURING_LUNCH.getTime() + 30_000);
    expect(isOk(check(issued.token, atExpiry))).toBe(true);
  });
});

describe("verifyToken — threat model (§6.1)", () => {
  it("rejects a forged signature", () => {
    const issued = mint();
    const forged = `${issued.token.split(".")[0]}.sig(totally-made-up)`;
    const result = check(forged, DURING_LUNCH);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("INVALID_TOKEN");
  });

  it("rejects a payload tampered with after signing", () => {
    // Swap the student id for someone else's, keeping the original signature.
    const issued = mint();
    const signature = issued.token.split(".")[1]!;
    const tampered = base64UrlEncode(
      JSON.stringify({
        v: 1,
        t: TENANT_A,
        s: "44444444-4444-4444-4444-444444444444",
        m: "LUNCH",
        d: "2026-07-05",
        iat: DURING_LUNCH.getTime(),
        n: "nonce-1",
      }),
    );
    const result = check(`${tampered}.${signature}`, DURING_LUNCH);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("INVALID_TOKEN");
  });

  it("rejects a token signed with another tenant's secret", () => {
    // Tenant B mints for its own student; tenant A's scanner must refuse it.
    const foreign = unwrap(
      issueToken({
        tenantId: TENANT_B,
        studentId: STUDENT,
        mealSlot: "LUNCH",
        serviceDate: serviceDateOf(IST, DURING_LUNCH),
        settings,
        now: DURING_LUNCH,
        timezone: IST,
        secret: SECRET_B,
        nonce: "n",
        signer: fakeSigner,
      }),
    );
    const result = check(foreign.token, DURING_LUNCH);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("INVALID_TOKEN");
  });

  it("rejects a cross-tenant token even if the secret were shared", () => {
    // Defence in depth: same secret, wrong tenant in the payload.
    const foreign = unwrap(
      issueToken({
        tenantId: TENANT_B,
        studentId: STUDENT,
        mealSlot: "LUNCH",
        serviceDate: serviceDateOf(IST, DURING_LUNCH),
        settings,
        now: DURING_LUNCH,
        timezone: IST,
        secret: SECRET_A,
        nonce: "n",
        signer: fakeSigner,
      }),
    );
    const result = check(foreign.token, DURING_LUNCH);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("TENANT_MISMATCH");
  });

  it("rejects a screenshotted token once its TTL lapses", () => {
    const issued = mint();
    const oneSecondLate = new Date(DURING_LUNCH.getTime() + 31_000);
    const result = check(issued.token, oneSecondLate);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe("EXPIRED_TOKEN");
      expect(result.error.details?.ttlSeconds).toBe(30);
    }
  });

  it("rejects a token with an implausible future timestamp", () => {
    const issued = mint(new Date(DURING_LUNCH.getTime() + 60_000));
    const result = check(issued.token, DURING_LUNCH);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("INVALID_TOKEN");
  });

  it("tolerates small clock skew between phone and server", () => {
    // A phone 3 seconds fast must not be rejected — that would be a support
    // nightmare at the counter.
    const issued = mint(new Date(DURING_LUNCH.getTime() + 3_000));
    expect(isOk(check(issued.token, DURING_LUNCH))).toBe(true);
  });

  it("rejects a scan outside the meal window", () => {
    // A *fresh* lunch token minted and scanned at 16:00 IST — between services.
    // Issuance deliberately does not enforce the window (a student may open the
    // screen early), so the counter is where it must be refused.
    const betweenMeals = new Date("2026-07-05T10:30:00Z");
    const issued = mint(betweenMeals);
    const result = check(issued.token, betweenMeals);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe("OUTSIDE_MEAL_HOURS");
      expect(result.error.details?.slot).toBe("LUNCH");
    }
  });

  it("checks TTL before the meal window, so a stale code reads as expired", () => {
    // Staff need the actionable message ("ask them to refresh"), not the
    // ambiguous one, when both conditions happen to be true.
    const issued = mint();
    const result = check(issued.token, new Date("2026-07-05T10:30:00Z"));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("EXPIRED_TOKEN");
  });

  it("rejects a superseded payload version", () => {
    const stale = base64UrlEncode(
      JSON.stringify({
        v: 0,
        t: TENANT_A,
        s: STUDENT,
        m: "LUNCH",
        d: "2026-07-05",
        iat: 1,
        n: "x",
      }),
    );
    const result = check(`${stale}.${fakeSigner.sign(stale, SECRET_A)}`, DURING_LUNCH);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("INVALID_TOKEN");
  });
});

describe("verifyToken — malformed input fails closed (§2.7)", () => {
  it.each([
    ["empty string", ""],
    ["no separator", "abcdef"],
    ["leading separator", ".signature"],
    ["trailing separator", "payload."],
  ])("rejects %s", (_label, token) => {
    const result = check(token, DURING_LUNCH);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("INVALID_TOKEN");
  });

  it("rejects a correctly-signed payload that is not valid JSON", () => {
    const garbage = base64UrlEncode("not json at all");
    const result = check(`${garbage}.${fakeSigner.sign(garbage, SECRET_A)}`, DURING_LUNCH);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("INVALID_TOKEN");
  });

  it("rejects a correctly-signed payload carrying an impossible date", () => {
    const bad = base64UrlEncode(
      JSON.stringify({
        v: 1,
        t: TENANT_A,
        s: STUDENT,
        m: "LUNCH",
        d: "2026-02-30",
        iat: DURING_LUNCH.getTime(),
        n: "x",
      }),
    );
    const result = check(`${bad}.${fakeSigner.sign(bad, SECRET_A)}`, DURING_LUNCH);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("INVALID_TOKEN");
  });

  it("rejects a payload for a slot the tenant stopped serving", () => {
    const bad = base64UrlEncode(
      JSON.stringify({
        v: 1,
        t: TENANT_A,
        s: STUDENT,
        m: "BREAKFAST",
        d: "2026-07-05",
        iat: DURING_LUNCH.getTime(),
        n: "x",
      }),
    );
    const result = check(`${bad}.${fakeSigner.sign(bad, SECRET_A)}`, DURING_LUNCH);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("SLOT_NOT_SERVED");
  });
});

describe("currentMealSlot", () => {
  it("identifies the slot being served now", () => {
    expect(currentMealSlot(settings, IST, DURING_LUNCH)).toBe("LUNCH");
    // 20:00 IST = 14:30Z
    expect(currentMealSlot(settings, IST, new Date("2026-07-05T14:30:00Z"))).toBe("DINNER");
  });

  it("returns nothing between services", () => {
    expect(currentMealSlot(settings, IST, new Date("2026-07-05T10:30:00Z"))).toBeUndefined();
  });

  it("attributes a past-midnight scan to the previous day's late dinner", () => {
    const lateDinner: TenantSettings = {
      ...settings,
      mealSlots: [
        { slot: "DINNER", start: toWallClockTime("22:00"), end: toWallClockTime("00:30") },
      ],
    };
    // 00:15 IST on 6 July = 18:45Z on 5 July. Still the 5th's dinner service.
    expect(currentMealSlot(lateDinner, IST, new Date("2026-07-05T18:45:00Z"))).toBe("DINNER");
  });
});
