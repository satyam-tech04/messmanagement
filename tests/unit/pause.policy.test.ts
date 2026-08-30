/**
 * Subscription pauses — the "grace period" feature, named for what it does.
 *
 * The word "grace" was already taken. `student_status.GRACE` means *unpaid
 * dues, still allowed to eat*, and `eligibility.policy.ts` carries an explicit
 * comment saying it deliberately passes. This feature means the opposite:
 * paused, must not eat. Reusing the status would either feed paused students or
 * refuse dues-grace students at the counter, so the two never touch.
 *
 * The hard requirement is spec §22: an admin who edits a pause four times must
 * not extend the subscription four times. Every calculation here anchors on
 * `endDateBeforePause` — the end date as it stood when the pause was first
 * created — which makes recalculation idempotent no matter how many edits
 * precede it. The accumulation test below is the one that would catch a
 * regression.
 */
import { describe, expect, it } from "vitest";
import {
  activePauseOn,
  cancelPause,
  graceDays,
  isPausedOn,
  parsePauseDraft,
  pauseStateLabel,
  pauseStateOf,
  resumePauseEarly,
  type PauseRecord,
  type PauseDraftInput,
} from "@/core/policies/pause.policy";
import type { SubscriptionDates } from "@/core/policies/subscription-state";
import { toServiceDate } from "@/core/time";

const d = toServiceDate;
const today = d("2026-08-30");

function pause(over: Partial<PauseRecord> = {}): PauseRecord {
  return {
    status: "ACTIVE",
    startDate: d("2026-09-10"),
    resumeDate: d("2026-09-16"),
    ...over,
  };
}

function subscription(over: Partial<SubscriptionDates> = {}): SubscriptionDates {
  return {
    status: "ACTIVE",
    startDate: d("2026-08-01"),
    endDate: d("2026-10-10"),
    ...over,
  };
}

function draft(over: Partial<PauseDraftInput> = {}): PauseDraftInput {
  return {
    actorRole: "ADMIN",
    subscription: subscription(),
    startDate: d("2026-09-10"),
    resumeDate: d("2026-09-16"),
    today,
    remarks: "Student leave",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Grace days — spec §5.3, §21
// ---------------------------------------------------------------------------

describe("graceDays", () => {
  it("counts the start date and excludes the resume date (AC5)", () => {
    // The spec's own worked example: 30 Aug to 5 Sep is six paused days —
    // 30, 31, 1, 2, 3, 4 — and the student eats again on the 5th.
    expect(graceDays(d("2026-08-30"), d("2026-09-05"))).toBe(6);
  });

  it("matches the §21 example of 1 Oct to 4 Oct being three days", () => {
    expect(graceDays(d("2026-10-01"), d("2026-10-04"))).toBe(3);
  });

  it("is zero when the pause is resumed on the day it started", () => {
    // Reachable only through an early resume on the start date. Nothing was
    // actually paused, so nothing is owed back.
    expect(graceDays(d("2026-09-10"), d("2026-09-10"))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Derived state — F9: nothing sweeps this table, so dates decide
// ---------------------------------------------------------------------------

describe("pauseStateOf", () => {
  it("is SCHEDULED before the start date", () => {
    expect(pauseStateOf(pause(), d("2026-09-09"))).toBe("SCHEDULED");
  });

  it("is RUNNING on the start date itself — the first paused day", () => {
    expect(pauseStateOf(pause(), d("2026-09-10"))).toBe("RUNNING");
  });

  it("is RUNNING on the day before the resume date", () => {
    expect(pauseStateOf(pause(), d("2026-09-15"))).toBe("RUNNING");
  });

  it("is COMPLETED on the resume date — the first active day again", () => {
    // The boundary that the whole feature turns on. Half-open [start, resume).
    expect(pauseStateOf(pause(), d("2026-09-16"))).toBe("COMPLETED");
  });

  it("is CANCELLED whatever the dates say", () => {
    // A deliberate decision outranks the calendar, exactly as a cancelled
    // subscription does in subscription-state.ts.
    const cancelled = pause({ status: "CANCELLED" });
    expect(pauseStateOf(cancelled, d("2026-09-12"))).toBe("CANCELLED");
  });
});

// ---------------------------------------------------------------------------
// The counter's question — spec §10, §11, AC7, AC8
// ---------------------------------------------------------------------------

describe("isPausedOn", () => {
  it("blocks meals on the start date", () => {
    expect(isPausedOn(pause(), d("2026-09-10"))).toBe(true);
  });

  it("blocks meals on the last paused day", () => {
    expect(isPausedOn(pause(), d("2026-09-15"))).toBe(true);
  });

  it("allows meals again on the resume date (AC9)", () => {
    expect(isPausedOn(pause(), d("2026-09-16"))).toBe(false);
  });

  it("allows meals before the pause begins", () => {
    expect(isPausedOn(pause(), d("2026-09-09"))).toBe(false);
  });

  it("never blocks on a cancelled pause (AC13)", () => {
    expect(isPausedOn(pause({ status: "CANCELLED" }), d("2026-09-12"))).toBe(false);
  });
});

describe("activePauseOn", () => {
  it("finds the pause covering the service date out of several", () => {
    // A student may go home in September and again in November. The database
    // permits any number of non-overlapping pauses, so the policy must pick.
    const pauses = [
      pause({ startDate: d("2026-09-10"), resumeDate: d("2026-09-16") }),
      pause({ startDate: d("2026-11-01"), resumeDate: d("2026-11-05") }),
    ];
    expect(activePauseOn(pauses, d("2026-11-03"))?.startDate).toBe(d("2026-11-01"));
  });

  it("returns null when the date falls between two pauses", () => {
    const pauses = [
      pause({ startDate: d("2026-09-10"), resumeDate: d("2026-09-16") }),
      pause({ startDate: d("2026-11-01"), resumeDate: d("2026-11-05") }),
    ];
    expect(activePauseOn(pauses, d("2026-10-01"))).toBeNull();
  });

  it("returns null for an empty list — the overwhelmingly common case", () => {
    expect(activePauseOn([], today)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Creating a pause — spec §5, §19, §27, and D-15
// ---------------------------------------------------------------------------

describe("parsePauseDraft — date rules", () => {
  it("accepts a valid future pause inside the subscription period", () => {
    const result = parsePauseDraft(draft());
    expect(result.ok).toBe(true);
  });

  it("allows a pause starting today (D-15, overriding spec §5.1)", () => {
    // The spec rejects today. The owner overrode that on 2026-08-30: an admin
    // told at 9am that a student went home this morning must be able to act
    // now, not tomorrow after the student has eaten three more meals.
    const result = parsePauseDraft(draft({ startDate: today, resumeDate: d("2026-09-05") }));
    expect(result.ok).toBe(true);
  });

  it("rejects a start date in the past (AC2, Case 2)", () => {
    const result = parsePauseDraft(
      draft({ startDate: d("2026-08-29"), resumeDate: d("2026-09-05") }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a resume date equal to the start date (AC4, Case 4)", () => {
    const result = parsePauseDraft(draft({ resumeDate: d("2026-09-10") }));
    expect(result.ok).toBe(false);
  });

  it("rejects a resume date before the start date (Case 5)", () => {
    const result = parsePauseDraft(draft({ resumeDate: d("2026-09-08") }));
    expect(result.ok).toBe(false);
  });

  it("rejects a start before the subscription start date (AC3, Case 3)", () => {
    // The spec's example: subscription 10 Sep–10 Oct, pause 5 Sep–12 Sep.
    const result = parsePauseDraft(
      draft({
        subscription: subscription({
          startDate: d("2026-09-10"),
          endDate: d("2026-10-10"),
        }),
        startDate: d("2026-09-05"),
        resumeDate: d("2026-09-12"),
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a pause starting after the subscription ends", () => {
    const result = parsePauseDraft(
      draft({ startDate: d("2026-10-20"), resumeDate: d("2026-10-25") }),
    );
    expect(result.ok).toBe(false);
  });
});

describe("parsePauseDraft — remarks", () => {
  it("requires a reason, matching how ending a subscription already behaves", () => {
    // `endSubscription` demands a reason before cancelling a plan. Pausing one
    // is comparably consequential, and §20 puts Remarks on the confirmation
    // screen, so the same bar applies.
    const result = parsePauseDraft(draft({ remarks: "  " }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("trims the stored remark", () => {
    const result = parsePauseDraft(draft({ remarks: "  Went home  " }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.remarks).toBe("Went home");
  });
});

describe("parsePauseDraft — subscription eligibility", () => {
  it("rejects a cancelled subscription (AC15, Case 6)", () => {
    const result = parsePauseDraft(draft({ subscription: subscription({ status: "CANCELLED" }) }));
    expect(result.ok).toBe(false);
  });

  it("rejects an expired subscription — which §3 forgot to exclude (F11)", () => {
    // §3 excludes only cancelled subscriptions. An expired one is equally
    // ineligible: there is nothing left to pause.
    const result = parsePauseDraft(
      draft({
        subscription: subscription({
          startDate: d("2026-06-01"),
          endDate: d("2026-06-30"),
        }),
        startDate: d("2026-09-10"),
        resumeDate: d("2026-09-16"),
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("accepts an upcoming subscription (Case 7)", () => {
    // Spec §9: a pause may be configured before the subscription begins, so
    // long as it falls inside the subscription period.
    const result = parsePauseDraft(
      draft({
        subscription: subscription({
          startDate: d("2026-09-10"),
          endDate: d("2026-10-10"),
        }),
        startDate: d("2026-09-15"),
        resumeDate: d("2026-09-20"),
      }),
    );
    expect(result.ok).toBe(true);
  });
});

describe("parsePauseDraft — permissions (spec §18)", () => {
  it("refuses staff", () => {
    const result = parsePauseDraft(draft({ actorRole: "STAFF" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
  });

  it("refuses students", () => {
    const result = parsePauseDraft(draft({ actorRole: "STUDENT" }));
    expect(result.ok).toBe(false);
  });

  it("allows the platform operator, not only a mess admin (F4)", () => {
    // The spec says there are three roles. There are four, and SUPER_ADMIN is
    // the account that supports customers — locking it out would break the one
    // feature most likely to generate a support call.
    const result = parsePauseDraft(draft({ actorRole: "SUPER_ADMIN" }));
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The end date — D-18 and spec §7, §8
// ---------------------------------------------------------------------------

describe("parsePauseDraft — end date", () => {
  it("computes the end date as the anchor plus the paused days (§8)", () => {
    // Subscription ends 10 Oct; six paused days pushes it to 16 Oct.
    const result = parsePauseDraft(draft());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.graceDays).toBe(6);
    expect(result.value.computedEndDate).toBe(d("2026-10-16"));
    expect(result.value.subscriptionEndDate).toBe(d("2026-10-16"));
    expect(result.value.isEndDateOverridden).toBe(false);
  });

  it("anchors on the subscription's current end date when first created", () => {
    const result = parsePauseDraft(draft());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.endDateBeforePause).toBe(d("2026-10-10"));
  });

  it("keeps the admin's entered end date and records the override (§7)", () => {
    // §7 is emphatic that the system must not silently replace what the admin
    // typed. Both values are stored so the divergence is visible rather than
    // lost.
    const result = parsePauseDraft(draft({ subscriptionEndDate: d("2026-10-20") }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.computedEndDate).toBe(d("2026-10-16"));
    expect(result.value.subscriptionEndDate).toBe(d("2026-10-20"));
    expect(result.value.isEndDateOverridden).toBe(true);
  });

  it("rejects an entered end date before the resume date", () => {
    // A subscription that ends before the student is allowed to eat again is
    // not a subscription; it is a typo.
    const result = parsePauseDraft(draft({ subscriptionEndDate: d("2026-09-14") }));
    expect(result.ok).toBe(false);
  });

  it("does NOT accumulate across repeated edits (§22, F8)", () => {
    // The requirement the spec states and does not answer. An admin edits the
    // same pause three times; the subscription must end six days later than it
    // originally would have, not eighteen.
    const first = parsePauseDraft(draft());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const anchor = first.value.endDateBeforePause;
    expect(first.value.subscriptionEndDate).toBe(d("2026-10-16"));

    // Second edit: the subscription row now says 16 Oct, but the anchor is
    // still 10 Oct and is passed back in.
    const second = parsePauseDraft(
      draft({
        subscription: subscription({ endDate: first.value.subscriptionEndDate }),
        endDateBeforePause: anchor,
      }),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.subscriptionEndDate).toBe(d("2026-10-16"));

    // Third edit, extending the pause by four more days (spec §15).
    const third = parsePauseDraft(
      draft({
        subscription: subscription({ endDate: second.value.subscriptionEndDate }),
        endDateBeforePause: anchor,
        resumeDate: d("2026-09-20"),
      }),
    );
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(third.value.graceDays).toBe(10);
    expect(third.value.subscriptionEndDate).toBe(d("2026-10-20"));
  });
});

// ---------------------------------------------------------------------------
// Early resume — spec §16, AC14
// ---------------------------------------------------------------------------

describe("resumePauseEarly", () => {
  const running = {
    status: "ACTIVE",
    startDate: d("2026-09-20"),
    resumeDate: d("2026-09-30"),
    endDateBeforePause: d("2026-10-10"),
  };

  it("extends by the days actually paused, not the days scheduled (AC14)", () => {
    // The spec's example: a 20–30 Sep pause resumed on the 25th. Five days were
    // actually paused, so the subscription gains five days, not ten.
    const result = resumePauseEarly({
      actorRole: "ADMIN",
      pause: running,
      resumeOn: d("2026-09-25"),
      today: d("2026-09-25"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.graceDays).toBe(5);
    expect(result.value.subscriptionEndDate).toBe(d("2026-10-15"));
  });

  it("gives back nothing when resumed on the day it started", () => {
    const result = resumePauseEarly({
      actorRole: "ADMIN",
      pause: running,
      resumeOn: d("2026-09-20"),
      today: d("2026-09-20"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.graceDays).toBe(0);
    expect(result.value.subscriptionEndDate).toBe(d("2026-10-10"));
  });

  it("refuses to resume a pause that has not started — that is a cancel (§17)", () => {
    const result = resumePauseEarly({
      actorRole: "ADMIN",
      pause: running,
      resumeOn: d("2026-09-15"),
      today: d("2026-09-15"),
    });
    expect(result.ok).toBe(false);
  });

  it("refuses a resume date beyond the scheduled one — that is an extend (§15)", () => {
    const result = resumePauseEarly({
      actorRole: "ADMIN",
      pause: running,
      resumeOn: d("2026-10-05"),
      today: d("2026-09-25"),
    });
    expect(result.ok).toBe(false);
  });

  it("refuses staff", () => {
    const result = resumePauseEarly({
      actorRole: "STAFF",
      pause: running,
      resumeOn: d("2026-09-25"),
      today: d("2026-09-25"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
  });
});

// ---------------------------------------------------------------------------
// Cancelling — spec §17, AC13
// ---------------------------------------------------------------------------

describe("cancelPause", () => {
  const scheduled = {
    status: "ACTIVE",
    startDate: d("2026-09-10"),
    resumeDate: d("2026-09-16"),
    endDateBeforePause: d("2026-10-10"),
  };

  it("restores the subscription end date exactly (AC13)", () => {
    // "The subscription remains unchanged. No subscription extension is
    // applied." The anchor is what makes that recoverable.
    const result = cancelPause({ actorRole: "ADMIN", pause: scheduled, today });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.subscriptionEndDate).toBe(d("2026-10-10"));
  });

  it("refuses to cancel a pause already running — use early resume (§17)", () => {
    const result = cancelPause({
      actorRole: "ADMIN",
      pause: scheduled,
      today: d("2026-09-12"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ILLEGAL_TRANSITION");
  });

  it("refuses staff", () => {
    const result = cancelPause({ actorRole: "STAFF", pause: scheduled, today });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The guards that only fire on bad input
//
// Each of these was an uncovered branch after the first pass. They are cheap to
// test and expensive to get wrong: a missing upper bound on a date field is how
// a mistyped year becomes a subscription that runs until 2031.
// ---------------------------------------------------------------------------

describe("parsePauseDraft — bounds", () => {
  it("rejects a pause longer than a year, which is always a typo", () => {
    const result = parsePauseDraft(
      draft({
        subscription: subscription({ endDate: d("2030-01-01") }),
        startDate: d("2026-09-10"),
        resumeDate: d("2028-09-10"),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a remark longer than the column allows", () => {
    // Better a sentence here than a database error the admin cannot act on.
    const result = parsePauseDraft(draft({ remarks: "x".repeat(501) }));
    expect(result.ok).toBe(false);
  });
});

describe("resumePauseEarly — bounds", () => {
  it("refuses a resume date before the pause even began", () => {
    // Distinct from "the pause has not started": here the pause IS running, and
    // the admin has typed a date behind its start, which would compute a
    // negative number of paused days.
    const result = resumePauseEarly({
      actorRole: "ADMIN",
      pause: {
        status: "ACTIVE",
        startDate: d("2026-09-20"),
        resumeDate: d("2026-09-30"),
        endDateBeforePause: d("2026-10-10"),
      },
      resumeOn: d("2026-09-18"),
      today: d("2026-09-25"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
  });
});

describe("pauseStateLabel", () => {
  it("names every state — these strings reach the admin's screen", () => {
    expect(pauseStateLabel("SCHEDULED")).toBe("Scheduled");
    expect(pauseStateLabel("RUNNING")).toBe("Paused");
    expect(pauseStateLabel("COMPLETED")).toBe("Ended");
    expect(pauseStateLabel("CANCELLED")).toBe("Cancelled");
  });
});
