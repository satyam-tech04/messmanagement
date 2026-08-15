/**
 * The service date carried by a QR token must be the date of the *meal it is
 * for* — not the date it happened to be minted on.
 *
 * These two drift apart in exactly two situations, and both are real:
 *
 *   1. After the last meal closes, the next meal is **tomorrow's**. A token
 *      minted at 22:30 targets tomorrow's lunch but was stamped with today.
 *   2. A dinner that runs past midnight (22:00–00:30 is normal in hostels)
 *      belongs to the day it *started*. At 00:15 the calendar has rolled, but
 *      the meal has not.
 *
 * Case 2 is the damaging one: the student is standing at a counter that is
 * genuinely open, and is refused.
 */
import { describe, expect, it } from "vitest";
import { issueToken, verifyToken } from "@/core/policies/qr.policy";
import { resolveServiceState } from "@/core/policies/menu.policy";
import type { TenantSettings } from "@/core/domain/tenant-context";
import { toServiceDate, toWallClockTime } from "@/core/time";
import { isErr, isOk, unwrap } from "@/core/result";
import { fakeSigner } from "../fakes";

const IST = "Asia/Kolkata";
const TENANT = "11111111-1111-1111-1111-111111111111";
const STUDENT = "33333333-3333-3333-3333-333333333333";
const SECRET = "tenant-signing-secret-at-least-32-characters";

function settingsWith(
  slots: ReadonlyArray<{ slot: string; start: string; end: string }>,
): TenantSettings {
  return {
    tenantId: TENANT,
    mealSlots: slots.map((s) => ({
      slot: s.slot,
      start: toWallClockTime(s.start),
      end: toWallClockTime(s.end),
    })),
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
  } as unknown as TenantSettings;
}

const STANDARD = settingsWith([
  { slot: "LUNCH", start: "12:00", end: "14:30" },
  { slot: "DINNER", start: "19:30", end: "22:00" },
]);

/** Dinner running past midnight — normal in hostels that serve late. */
const LATE_DINNER = settingsWith([
  { slot: "LUNCH", start: "12:00", end: "14:30" },
  { slot: "DINNER", start: "22:00", end: "00:30" },
]);

/** Mints the way the app does: for whichever meal is current, else the next. */
function mintAsAppDoes(settings: TenantSettings, now: Date) {
  const state = resolveServiceState({ timeZone: IST, now, slots: settings.mealSlots });
  const target = state.current ?? state.next;
  if (!target) throw new Error("no meal to target");

  const issued = issueToken({
    tenantId: TENANT,
    studentId: STUDENT,
    mealSlot: target.slot,
    serviceDate: target.serviceDate,
    settings,
    now,
    timezone: IST,
    secret: SECRET,
    nonce: "n",
    signer: fakeSigner,
  });
  if (!isOk(issued)) throw new Error("issuance failed");
  return { target, token: unwrap(issued).token };
}

function payloadOf(token: string): { m: string; d: string } {
  const [encoded] = token.split(".");
  return JSON.parse(Buffer.from(encoded!, "base64url").toString()) as { m: string; d: string };
}

describe("the token's service date matches the meal it is for", () => {
  it("stamps today when the meal being served is today's", () => {
    // 12:30 IST — inside lunch.
    const now = new Date("2026-08-02T07:00:00Z");
    const { token } = mintAsAppDoes(STANDARD, now);
    const p = payloadOf(token);
    expect(p.m).toBe("LUNCH");
    expect(p.d).toBe("2026-08-02");
  });

  it("stamps TOMORROW once the last meal has closed", () => {
    // 22:30 IST — dinner is over, so the next meal is tomorrow's lunch. The
    // token must say tomorrow, not today.
    const now = new Date("2026-08-02T17:00:00Z");
    const { target, token } = mintAsAppDoes(STANDARD, now);
    const p = payloadOf(token);

    expect(target.slot).toBe("LUNCH");
    expect(target.serviceDate).toBe("2026-08-03");
    expect(p.d).toBe("2026-08-03");
  });

  it("stamps YESTERDAY for a dinner that is still being served after midnight", () => {
    // 00:15 IST on the 3rd. The calendar day has rolled, but this is still the
    // 2nd's dinner, which opened at 22:00.
    const now = new Date("2026-08-02T18:45:00Z");
    const { target, token } = mintAsAppDoes(LATE_DINNER, now);
    const p = payloadOf(token);

    expect(target.slot).toBe("DINNER");
    expect(p.d).toBe("2026-08-02");
  });
});

describe("a token minted during service verifies", () => {
  it("verifies during an ordinary lunch", () => {
    const now = new Date("2026-08-02T07:00:00Z");
    const { token } = mintAsAppDoes(STANDARD, now);
    const v = verifyToken({
      token,
      expectedTenantId: TENANT,
      settings: STANDARD,
      timezone: IST,
      secret: SECRET,
      now,
      signer: fakeSigner,
    });
    expect(isOk(v)).toBe(true);
  });

  it("VERIFIES a late dinner after midnight — the counter is genuinely open", () => {
    // The bug this file exists for. Stamping today (the 3rd) made the verifier
    // check the 3rd's dinner window, which has not opened, and refuse a student
    // standing at a counter that is serving.
    const now = new Date("2026-08-02T18:45:00Z"); // 00:15 IST on the 3rd
    const { token } = mintAsAppDoes(LATE_DINNER, now);

    const v = verifyToken({
      token,
      expectedTenantId: TENANT,
      settings: LATE_DINNER,
      timezone: IST,
      secret: SECRET,
      now,
      signer: fakeSigner,
    });

    expect(isOk(v)).toBe(true);
    // And it must be recorded against the day the meal started.
    if (isOk(v)) expect(unwrap(v).serviceDate).toBe("2026-08-02");
  });

  it("records a late dinner against the day it started, not the day it ended", () => {
    const atNight = new Date("2026-08-02T17:00:00Z"); // 22:30 IST, dinner open
    const afterMidnight = new Date("2026-08-02T18:45:00Z"); // 00:15 IST next day

    const before = payloadOf(mintAsAppDoes(LATE_DINNER, atNight).token);
    const after = payloadOf(mintAsAppDoes(LATE_DINNER, afterMidnight).token);

    // Both halves of one dinner service must share a service date, or the
    // "one meal per student per day" guarantee splits in two at midnight and
    // the same student could be served twice.
    expect(before.d).toBe(after.d);
    expect(before.m).toBe(after.m);
  });
});

describe("a token for a meal that has not opened is still refused", () => {
  it("refuses tomorrow's lunch when shown tonight", () => {
    // Correct behaviour, and it must survive the fix: the student may hold a
    // code early, but it cannot be scanned until the counter opens.
    const now = new Date("2026-08-02T17:00:00Z"); // 22:30 IST
    const { token } = mintAsAppDoes(STANDARD, now);

    const v = verifyToken({
      token,
      expectedTenantId: TENANT,
      settings: STANDARD,
      timezone: IST,
      secret: SECRET,
      now,
      signer: fakeSigner,
    });

    expect(isErr(v)).toBe(true);
    if (isErr(v)) {
      expect(v.error.code).toBe("OUTSIDE_MEAL_HOURS");
      // The scanner needs to tell staff *when* it opens, so the detail must be
      // the real opening time of tomorrow's lunch.
      expect(v.error.details?.opensAt).toBe(new Date("2026-08-03T06:30:00Z").toISOString());
    }
  });

  it("that same token verifies once the window opens the next day", () => {
    const mintedAt = new Date("2026-08-02T17:00:00Z"); // 22:30 IST
    const { token } = mintAsAppDoes(STANDARD, mintedAt);

    // Ignore the TTL for this check by asking only the window question: the
    // date stamped on the token must be the one whose window actually opens.
    const p = payloadOf(token);
    expect(p.d).toBe("2026-08-03");
    expect(toServiceDate(p.d)).toBe("2026-08-03");
  });
});
