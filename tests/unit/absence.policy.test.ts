/**
 * Tests for student absences — skipping a meal, and being away.
 *
 * Two rules carry the money:
 *
 *   * **Advance notice.** A cut that arrives after the kitchen has shopped and
 *     cooked saves nothing, so crediting it would just be a discount. The
 *     notice period is what makes a cut real.
 *   * **The monthly cap.** Without one a student pays only for meals they ate,
 *     while the mess's wages, rent and gas are already spent.
 *
 * D-05 is settled here as **per calendar month**: pooling lets absences bunch —
 * exam week arrives and half the hostel goes home — and the headcount
 * projection is the product's main claim. The *value* stays configurable, so a
 * mess can loosen it without a deploy.
 */
import { describe, expect, it } from "vitest";
import { MealSlot } from "@/core/domain/enums";
import {
  requestAbsence,
  daysUsedInMonth,
  type AbsenceRequest,
  type AbsenceSettings,
} from "@/core/policies/absence.policy";
import { toServiceDate, toWallClockTime } from "@/core/time";

const IST = "Asia/Kolkata";

const settings: AbsenceSettings = {
  allowMealSkipping: true,
  allowPartialDaySkip: true,
  allowAwayRequests: true,
  awayRequiresApproval: true,
  cutAdvanceHours: 12,
  cutMaxDaysPerMonth: 5,
  awayAdvanceHours: 24,
  awayMaxDays: 30,
  mealWindows: [
    { slot: MealSlot.LUNCH, start: toWallClockTime("12:00"), end: toWallClockTime("14:30") },
    { slot: MealSlot.DINNER, start: toWallClockTime("19:30"), end: toWallClockTime("22:00") },
  ],
};

/** 10:00 IST on 10 Aug. Lunch opens at 12:00, dinner at 19:30. */
const NOW = new Date("2026-08-10T04:30:00Z");

function req(over: Partial<AbsenceRequest> = {}): AbsenceRequest {
  return {
    kind: "SKIP",
    dateFrom: toServiceDate("2026-08-12"),
    dateTo: toServiceDate("2026-08-12"),
    mealSlots: [MealSlot.LUNCH, MealSlot.DINNER],
    settings,
    now: NOW,
    timeZone: IST,
    daysAlreadyUsedThisMonth: 0,
    ...over,
  };
}

describe("requestAbsence — the feature must be switched on", () => {
  it("accepts a skip when the mess allows it", () => {
    expect(requestAbsence(req()).ok).toBe(true);
  });

  it("refuses a skip when the mess has not enabled it", () => {
    const r = requestAbsence(req({ settings: { ...settings, allowMealSkipping: false } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });

  it("refuses an away request when the mess has not enabled it", () => {
    const r = requestAbsence(
      req({
        kind: "AWAY",
        dateTo: toServiceDate("2026-08-16"),
        settings: { ...settings, allowAwayRequests: false },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });
});

describe("requestAbsence — advance notice", () => {
  it("accepts a skip made well before the meal", () => {
    expect(requestAbsence(req()).ok).toBe(true);
  });

  it("refuses a skip for a meal starting inside the notice period", () => {
    // 10:00 now, lunch at 12:00 today — two hours, against a 12-hour rule. The
    // kitchen has already shopped and cooked for them.
    const r = requestAbsence(
      req({ dateFrom: toServiceDate("2026-08-10"), dateTo: toServiceDate("2026-08-10") }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION_FAILED");
  });

  it("names the earliest date that would be accepted", () => {
    const r = requestAbsence(
      req({ dateFrom: toServiceDate("2026-08-10"), dateTo: toServiceDate("2026-08-10") }),
    );
    if (!r.ok) expect(r.error.message).toContain("11 Aug");
  });

  it("refuses a date already in the past", () => {
    const r = requestAbsence(
      req({ dateFrom: toServiceDate("2026-08-01"), dateTo: toServiceDate("2026-08-01") }),
    );
    expect(r.ok).toBe(false);
  });

  it("applies a longer notice to being away than to skipping one meal", () => {
    // 20:00 on the 10th, so tomorrow's lunch is 16 hours off. That clears the
    // 12-hour skip rule but not the 24-hour away rule — the one window where
    // the two settings actually differ, which is what makes this worth testing.
    const lateEvening = new Date("2026-08-10T14:30:00Z");
    const period = {
      dateFrom: toServiceDate("2026-08-11"),
      dateTo: toServiceDate("2026-08-11"),
      now: lateEvening,
    };

    expect(requestAbsence(req({ ...period, kind: "SKIP" })).ok).toBe(true);

    const away = requestAbsence(req({ ...period, kind: "AWAY" }));
    expect(away.ok).toBe(false);
    if (!away.ok) expect(away.error.code).toBe("VALIDATION_FAILED");
  });
});

describe("requestAbsence — whole days versus single meals", () => {
  it("allows skipping one meal when the mess permits it", () => {
    const r = requestAbsence(req({ mealSlots: [MealSlot.LUNCH] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.mealSlots).toEqual([MealSlot.LUNCH]);
  });

  it("refuses a single meal when the mess only allows whole days", () => {
    // Some messes cook per day, so a lunch-only skip saves them nothing.
    const r = requestAbsence(
      req({
        mealSlots: [MealSlot.LUNCH],
        settings: { ...settings, allowPartialDaySkip: false },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION_FAILED");
  });

  it("still allows a whole day when partial skips are off", () => {
    const r = requestAbsence(req({ settings: { ...settings, allowPartialDaySkip: false } }));
    expect(r.ok).toBe(true);
  });

  it("refuses a meal the mess does not serve", () => {
    const r = requestAbsence(req({ mealSlots: [MealSlot.BREAKFAST] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("SLOT_NOT_SERVED");
  });

  it("refuses an empty meal list", () => {
    const r = requestAbsence(req({ mealSlots: [] }));
    expect(r.ok).toBe(false);
  });

  it("an away request always covers every meal served", () => {
    // Being away is not selective — nobody is present for half a day.
    const r = requestAbsence(
      req({
        kind: "AWAY",
        dateFrom: toServiceDate("2026-08-12"),
        dateTo: toServiceDate("2026-08-15"),
        mealSlots: [MealSlot.LUNCH],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.mealSlots).toEqual([MealSlot.LUNCH, MealSlot.DINNER]);
  });
});

describe("requestAbsence — the monthly cap (D-05: per calendar month)", () => {
  it("allows a skip within the cap", () => {
    expect(requestAbsence(req({ daysAlreadyUsedThisMonth: 4 })).ok).toBe(true);
  });

  it("refuses the day that would exceed the cap", () => {
    const r = requestAbsence(req({ daysAlreadyUsedThisMonth: 5 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("CONFLICT");
  });

  it("says how many days are left, not just that it failed", () => {
    const r = requestAbsence(req({ daysAlreadyUsedThisMonth: 5 }));
    if (!r.ok) expect(r.error.message).toContain("5");
  });

  it("counts the days in the request, not just the request", () => {
    // Four used, a three-day skip would make seven. Refused.
    const r = requestAbsence(
      req({
        dateFrom: toServiceDate("2026-08-12"),
        dateTo: toServiceDate("2026-08-14"),
        daysAlreadyUsedThisMonth: 4,
      }),
    );
    expect(r.ok).toBe(false);
  });

  it("does NOT cap an away request — a fortnight home is not over-skipping", () => {
    // The whole reason away is separate. The admin reviews it instead.
    const r = requestAbsence(
      req({
        kind: "AWAY",
        dateFrom: toServiceDate("2026-08-12"),
        dateTo: toServiceDate("2026-08-25"),
        daysAlreadyUsedThisMonth: 5,
      }),
    );
    expect(r.ok).toBe(true);
  });

  it("reports the days a request consumes, so the caller can record them", () => {
    const r = requestAbsence(
      req({ dateFrom: toServiceDate("2026-08-12"), dateTo: toServiceDate("2026-08-14") }),
    );
    if (r.ok) expect(r.value.days).toBe(3);
  });
});

describe("requestAbsence — away length and approval", () => {
  it("refuses an away period longer than the mess allows", () => {
    // A mistyped year must not cancel a term's meals in one click.
    const r = requestAbsence(
      req({
        kind: "AWAY",
        dateFrom: toServiceDate("2026-08-12"),
        dateTo: toServiceDate("2026-12-12"),
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION_FAILED");
  });

  it("starts an away request PENDING when the mess reviews them", () => {
    const r = requestAbsence(
      req({
        kind: "AWAY",
        dateFrom: toServiceDate("2026-08-12"),
        dateTo: toServiceDate("2026-08-15"),
      }),
    );
    if (r.ok) expect(r.value.status).toBe("PENDING");
  });

  it("approves it immediately when the mess does not review them", () => {
    const r = requestAbsence(
      req({
        kind: "AWAY",
        dateFrom: toServiceDate("2026-08-12"),
        dateTo: toServiceDate("2026-08-15"),
        settings: { ...settings, awayRequiresApproval: false },
      }),
    );
    if (r.ok) expect(r.value.status).toBe("APPROVED");
  });

  it("a skip is always approved on the spot — it is self-service", () => {
    const r = requestAbsence(req());
    if (r.ok) expect(r.value.status).toBe("APPROVED");
  });

  it("refuses an end date before the start", () => {
    const r = requestAbsence(
      req({ dateFrom: toServiceDate("2026-08-14"), dateTo: toServiceDate("2026-08-12") }),
    );
    expect(r.ok).toBe(false);
  });
});

describe("daysUsedInMonth", () => {
  const august = toServiceDate("2026-08-12");

  it("counts a single-day cut as one", () => {
    const used = daysUsedInMonth(
      [{ dateFrom: toServiceDate("2026-08-03"), dateTo: toServiceDate("2026-08-03") }],
      august,
    );
    expect(used).toBe(1);
  });

  it("counts every day of a range", () => {
    const used = daysUsedInMonth(
      [{ dateFrom: toServiceDate("2026-08-03"), dateTo: toServiceDate("2026-08-05") }],
      august,
    );
    expect(used).toBe(3);
  });

  it("ignores cuts in other months — the cap is per calendar month", () => {
    const used = daysUsedInMonth(
      [{ dateFrom: toServiceDate("2026-07-03"), dateTo: toServiceDate("2026-07-06") }],
      august,
    );
    expect(used).toBe(0);
  });

  it("counts only the days that fall inside the month, for a cut spanning the boundary", () => {
    // 30 Jul – 2 Aug contributes two days to August, not four.
    const used = daysUsedInMonth(
      [{ dateFrom: toServiceDate("2026-07-30"), dateTo: toServiceDate("2026-08-02") }],
      august,
    );
    expect(used).toBe(2);
  });

  it("does not double-count overlapping cuts", () => {
    // A data anomaly, but the cap must not be silently consumed twice by one
    // day appearing in two rows.
    const used = daysUsedInMonth(
      [
        { dateFrom: toServiceDate("2026-08-03"), dateTo: toServiceDate("2026-08-05") },
        { dateFrom: toServiceDate("2026-08-04"), dateTo: toServiceDate("2026-08-06") },
      ],
      august,
    );
    expect(used).toBe(4);
  });

  it("is zero with no cuts at all", () => {
    expect(daysUsedInMonth([], august)).toBe(0);
  });
});
