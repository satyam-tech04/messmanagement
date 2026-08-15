/**
 * The scanner's outcome vocabulary (§6.4).
 *
 * "A generic red X forces staff to debug at the counter with a queue behind
 * them." Every denial must therefore say what happened, and what the staff
 * member should do next — those are two different sentences and both matter.
 */
import { describe, expect, it } from "vitest";
import {
  ALL_SCAN_OUTCOMES,
  refineScanAction,
  scanOutcomeFor,
  scanTitleFor,
} from "@/lib/scan-outcome";

describe("scanOutcomeFor — coverage", () => {
  const codes = [
    "ALREADY_SERVED",
    "BLOCKED_UNPAID",
    "NO_ACTIVE_PLAN",
    "ON_MESS_CUT",
    "OUTSIDE_MEAL_HOURS",
    "EXPIRED_TOKEN",
    "INVALID_TOKEN",
    "TENANT_MISMATCH",
    "STUDENT_INACTIVE",
    "SLOT_NOT_SERVED",
    "NOT_FOUND",
    "INFRASTRUCTURE_ERROR",
    "RATE_LIMITED",
    "FORBIDDEN",
  ] as const;

  it.each(codes)("maps %s to a distinct, actionable outcome", (code) => {
    const outcome = scanOutcomeFor(code);
    expect(outcome.title.length).toBeGreaterThan(0);
    // The second line tells staff what to do — "ask them to refresh", "send
    // them to the office" — not a restatement of the error.
    expect(outcome.action.length).toBeGreaterThan(0);
  });

  it("never falls back to a bare unknown for a code the domain can raise", () => {
    for (const code of codes) {
      expect(scanOutcomeFor(code).title).not.toMatch(/^unknown$/i);
    }
  });

  it("still returns something usable for a code it has never seen", () => {
    // Fail safe, not blank: a new domain error must not render an empty card.
    const outcome = scanOutcomeFor("SOME_FUTURE_CODE");
    expect(outcome.tone).toBe("danger");
    expect(outcome.title.length).toBeGreaterThan(0);
    expect(outcome.action.length).toBeGreaterThan(0);
  });
});

describe("scanOutcomeFor — tone carries meaning", () => {
  it("treats an already-served scan as a warning, not a failure", () => {
    // The student is legitimate and the system worked; they simply came twice.
    // Red here would make staff think something broke.
    expect(scanOutcomeFor("ALREADY_SERVED").tone).toBe("warning");
  });

  it("treats a blocked student as a hard denial", () => {
    expect(scanOutcomeFor("BLOCKED_UNPAID").tone).toBe("danger");
  });

  it("treats an expired code as a warning — it is the commonest, most harmless case", () => {
    expect(scanOutcomeFor("EXPIRED_TOKEN").tone).toBe("warning");
  });

  it("gives every outcome a tone the badge component understands", () => {
    for (const outcome of Object.values(ALL_SCAN_OUTCOMES)) {
      expect(["success", "warning", "danger", "info", "neutral"]).toContain(outcome.tone);
    }
  });
});

describe("scanOutcomeFor — retry guidance", () => {
  it("marks an expired code as retryable, because refreshing genuinely fixes it", () => {
    expect(scanOutcomeFor("EXPIRED_TOKEN").retryable).toBe(true);
  });

  it("marks an infrastructure failure as retryable", () => {
    expect(scanOutcomeFor("INFRASTRUCTURE_ERROR").retryable).toBe(true);
  });

  it("does NOT mark a blocked student as retryable — rescanning changes nothing", () => {
    // Offering "try again" here would have staff rescan a queue of one student
    // repeatedly while the queue behind them grows.
    expect(scanOutcomeFor("BLOCKED_UNPAID").retryable).toBe(false);
  });

  it("does not mark an already-served scan as retryable", () => {
    expect(scanOutcomeFor("ALREADY_SERVED").retryable).toBe(false);
  });
});

describe("scanOutcomeFor — the manual fallback", () => {
  it("offers the manual override when the failure is technical, not a refusal", () => {
    // §2.7: a wrongly-denied meal costs 20 seconds via the audited fallback.
    expect(scanOutcomeFor("INFRASTRUCTURE_ERROR").allowsManualOverride).toBe(true);
    expect(scanOutcomeFor("INVALID_TOKEN").allowsManualOverride).toBe(true);
    expect(scanOutcomeFor("EXPIRED_TOKEN").allowsManualOverride).toBe(true);
  });

  it("does NOT offer it when the student is genuinely ineligible", () => {
    // The fallback runs the same checks, so offering it here would only produce
    // the same refusal — while implying to staff that it might not.
    expect(scanOutcomeFor("BLOCKED_UNPAID").allowsManualOverride).toBe(false);
    expect(scanOutcomeFor("NO_ACTIVE_PLAN").allowsManualOverride).toBe(false);
    expect(scanOutcomeFor("ON_MESS_CUT").allowsManualOverride).toBe(false);
    expect(scanOutcomeFor("ALREADY_SERVED").allowsManualOverride).toBe(false);
  });
});

describe("scanOutcomeFor — the offline queue", () => {
  it("treats a buffered scan as informational, never as a failure", () => {
    // The student is standing at the counter and the scan looked valid. Showing
    // red would have staff turn them away over a Wi-Fi drop — precisely what
    // the offline queue exists to prevent.
    const outcome = scanOutcomeFor("QUEUED_OFFLINE");
    expect(outcome.tone).toBe("info");
    expect(outcome.tone).not.toBe("danger");
  });

  it("tells staff to serve the student", () => {
    expect(scanOutcomeFor("QUEUED_OFFLINE").action.toLowerCase()).toContain("serve");
  });

  it("does not offer a retry — the queue handles that itself", () => {
    expect(scanOutcomeFor("QUEUED_OFFLINE").retryable).toBe(false);
  });
});

describe("scanOutcomeFor — distinctness", () => {
  it("gives the five commonest denials five different titles", () => {
    // Staff learn to recognise these at a glance; two sharing wording defeats
    // the entire point of enumerating them.
    const titles = [
      "ALREADY_SERVED",
      "BLOCKED_UNPAID",
      "NO_ACTIVE_PLAN",
      "OUTSIDE_MEAL_HOURS",
      "EXPIRED_TOKEN",
    ].map((c) => scanOutcomeFor(c).title);

    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("refineScanAction — telling staff when the counter opens", () => {
  const tz = "Asia/Kolkata";

  it("names the opening time instead of a bare 'not being served'", () => {
    // "Counter closed" leaves staff guessing. With a queue behind them they
    // need the one fact that resolves it: when to send the student back.
    const action = refineScanAction(
      "OUTSIDE_MEAL_HOURS",
      { slot: "DINNER", opensAt: "2026-08-02T14:00:00Z" },
      tz,
    );
    expect(action).toContain("19:30");
    expect(action.toLowerCase()).toContain("dinner");
  });

  it("uses 24-hour time, so 19:30 cannot be read as morning", () => {
    const action = refineScanAction(
      "OUTSIDE_MEAL_HOURS",
      { slot: "DINNER", opensAt: "2026-08-02T14:00:00Z" },
      tz,
    );
    expect(action).not.toMatch(/[ap]m/i);
  });

  it("says tomorrow when the next sitting is not today", () => {
    // Scanned at 22:30, the next lunch is tomorrow. "Opens at 12:00" alone
    // would have staff tell the student to wait ninety minutes.
    const action = refineScanAction(
      "OUTSIDE_MEAL_HOURS",
      { slot: "LUNCH", opensAt: "2026-08-03T06:30:00Z" },
      tz,
      new Date("2026-08-02T17:00:00Z"),
    );
    expect(action.toLowerCase()).toContain("tomorrow");
  });

  it("falls back to the standard wording when no opening time is given", () => {
    const action = refineScanAction("OUTSIDE_MEAL_HOURS", null, tz);
    expect(action).toBe(scanOutcomeFor("OUTSIDE_MEAL_HOURS").action);
  });

  it("ignores malformed details rather than rendering 'Invalid Date'", () => {
    const action = refineScanAction("OUTSIDE_MEAL_HOURS", { opensAt: "not-a-date" }, tz);
    expect(action).toBe(scanOutcomeFor("OUTSIDE_MEAL_HOURS").action);
  });

  it("leaves every other outcome's wording untouched", () => {
    for (const code of ["ALREADY_SERVED", "BLOCKED_UNPAID", "NO_ACTIVE_PLAN", "EXPIRED_TOKEN"]) {
      expect(refineScanAction(code, { opensAt: "2026-08-02T14:00:00Z" }, tz)).toBe(
        scanOutcomeFor(code).action,
      );
    }
  });
});

describe("scanTitleFor — name the meal that was served", () => {
  it("says which meal, so staff and student both see it confirmed", () => {
    // "Served" alone leaves staff unsure whether the right meal was recorded,
    // especially when a window has just been changed.
    expect(scanTitleFor("SERVED", "BREAKFAST")).toBe("Breakfast served!");
    expect(scanTitleFor("SERVED", "DINNER")).toBe("Dinner served!");
  });

  it("names the meal on a duplicate too", () => {
    expect(scanTitleFor("ALREADY_SERVED", "LUNCH")).toBe("Lunch already served");
  });

  it("falls back to the plain title when the meal is unknown", () => {
    expect(scanTitleFor("SERVED", undefined)).toBe(scanOutcomeFor("SERVED").title);
    expect(scanTitleFor("ALREADY_SERVED", null)).toBe(scanOutcomeFor("ALREADY_SERVED").title);
  });

  it("leaves other outcomes alone — a blocked student is not about a meal", () => {
    expect(scanTitleFor("BLOCKED_UNPAID", "LUNCH")).toBe(scanOutcomeFor("BLOCKED_UNPAID").title);
    expect(scanTitleFor("EXPIRED_TOKEN", "LUNCH")).toBe(scanOutcomeFor("EXPIRED_TOKEN").title);
  });

  it("ignores a junk slot rather than rendering it raw", () => {
    expect(scanTitleFor("SERVED", "NOT_A_MEAL")).toBe(scanOutcomeFor("SERVED").title);
  });
});
