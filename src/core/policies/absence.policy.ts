/**
 * Student absences — skipping a meal, and being away (§7.1, D-05, D-06).
 *
 * Both end up in `mess_cuts`; they differ in who decides and what limits them.
 *
 *   * **Skipping** is short and self-service, and is what the monthly cap
 *     exists for. Without a cap a student pays only for the meals they ate,
 *     while the mess's wages, rent and gas are already spent.
 *
 *   * **Being away** is a planned absence of several days. The monthly cap
 *     would block a student going home for a fortnight, which is legitimate, so
 *     these are not capped — an admin reviews them instead, which also gives
 *     the kitchen warning of a large drop in the headcount.
 *
 * **D-05 is settled as per calendar month.** Pooling a quarterly allowance lets
 * absences bunch — exam week arrives and half the hostel goes home — and the
 * headcount projection is the product's main claim. The cap's *value* stays in
 * tenant settings, so a mess can loosen it without a deploy.
 *
 * **D-06 is settled as configurable.** A mess that cooks per day saves nothing
 * from a lunch-only skip, so `allowPartialDaySkip` lets it require whole days.
 */
import { ALL_MEAL_SLOTS, type MealSlot } from "@/core/domain/enums";
import type { MealSlotConfig } from "@/core/domain/tenant-context";
import { domainError, forbidden, type DomainError } from "@/core/errors";
import { err, ok, type Result } from "@/core/result";
import {
  addDays,
  compareServiceDates,
  eachDateInclusive,
  hoursBetween,
  mealWindowOn,
  monthKeyOf,
  serviceDateOf,
  type ServiceDate,
} from "@/core/time";

export type AbsenceKind = "SKIP" | "AWAY";

export interface AbsenceSettings {
  readonly allowMealSkipping: boolean;
  readonly allowPartialDaySkip: boolean;
  readonly allowAwayRequests: boolean;
  readonly awayRequiresApproval: boolean;
  readonly cutAdvanceHours: number;
  readonly cutMaxDaysPerMonth: number;
  readonly awayAdvanceHours: number;
  readonly awayMaxDays: number;
  /**
   * The meal windows this mess serves.
   *
   * Windows, not just slot names, because the notice period is measured to the
   * moment a meal *opens* — and that has to be resolved in the hostel's
   * timezone, never the server's.
   */
  readonly mealWindows: readonly MealSlotConfig[];
}

export interface AbsenceRequest {
  readonly kind: AbsenceKind;
  readonly dateFrom: ServiceDate;
  readonly dateTo: ServiceDate;
  readonly mealSlots: readonly MealSlot[];
  readonly settings: AbsenceSettings;
  readonly now: Date;
  readonly timeZone: string;
  /** Days already consumed this calendar month — see `daysUsedInMonth`. */
  readonly daysAlreadyUsedThisMonth: number;
}

export interface AbsenceDraft {
  readonly kind: AbsenceKind;
  readonly dateFrom: ServiceDate;
  readonly dateTo: ServiceDate;
  readonly mealSlots: readonly MealSlot[];
  readonly status: "PENDING" | "APPROVED";
  /** Calendar days the request covers, for cap accounting. */
  readonly days: number;
}

export interface CutPeriod {
  readonly dateFrom: ServiceDate;
  readonly dateTo: ServiceDate;
}

/**
 * Days consumed in the calendar month containing `reference`.
 *
 * Counted as a set of dates, not a sum of lengths: a cut spanning a month
 * boundary must only contribute the days inside this month, and two overlapping
 * cuts must not consume the same day twice.
 */
export function daysUsedInMonth(cuts: readonly CutPeriod[], reference: ServiceDate): number {
  const month = monthKeyOf(reference);
  const days = new Set<string>();

  for (const cut of cuts) {
    for (const date of eachDateInclusive(cut.dateFrom, cut.dateTo)) {
      if (monthKeyOf(date) === month) days.add(date);
    }
  }

  return days.size;
}

/** Ordered by time of day, so a stored list always reads the same way. */
function normalizeSlots(slots: readonly MealSlot[]): readonly MealSlot[] {
  const present = new Set(slots);
  return ALL_MEAL_SLOTS.filter((slot) => present.has(slot));
}

function formatDay(date: ServiceDate): string {
  const [, month, day] = date.split("-");
  const names = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${Number(day)} ${names[Number(month) - 1]}`;
}

export function requestAbsence(request: AbsenceRequest): Result<AbsenceDraft, DomainError> {
  const { settings, kind } = request;
  const servedSlots = settings.mealWindows.map((w) => w.slot);

  if (kind === "SKIP" && !settings.allowMealSkipping) {
    return err(forbidden("This mess does not let students skip meals."));
  }
  if (kind === "AWAY" && !settings.allowAwayRequests) {
    return err(forbidden("This mess does not take time-away requests."));
  }

  if (compareServiceDates(request.dateTo, request.dateFrom) < 0) {
    return err(domainError("VALIDATION_FAILED", "The last day cannot be before the first."));
  }

  // The allowance is per calendar month, so a skip crossing a boundary has no
  // single answer to "does this fit?". Splitting it here would be worse than
  // refusing: the student would submit one thing, find two in their list, and
  // only be able to have one of them if the next month were already full.
  // Away periods are uncapped and cross freely — a student going home over the
  // end of term is exactly what the two-kinds design exists to allow.
  if (kind === "SKIP" && monthKeyOf(request.dateFrom) !== monthKeyOf(request.dateTo)) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        "The monthly allowance resets on the 1st, so a skip cannot run into the next month. Submit one for each month.",
        { from: monthKeyOf(request.dateFrom), to: monthKeyOf(request.dateTo) },
      ),
    );
  }

  const dates = eachDateInclusive(request.dateFrom, request.dateTo);

  if (kind === "AWAY" && dates.length > settings.awayMaxDays) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `You can request up to ${settings.awayMaxDays} days away at once.`,
      ),
    );
  }

  // Being away is not selective — nobody is present for half a day — so it
  // always covers every meal the mess serves, whatever was submitted.
  const slots = kind === "AWAY" ? normalizeSlots(servedSlots) : normalizeSlots(request.mealSlots);

  if (slots.length === 0) {
    return err(domainError("VALIDATION_FAILED", "Choose at least one meal."));
  }

  const unserved = slots.filter((slot) => !servedSlots.includes(slot));
  if (unserved.length > 0) {
    return err(
      domainError(
        "SLOT_NOT_SERVED",
        `This mess does not serve ${unserved.map((s) => s.toLowerCase()).join(" or ")}.`,
      ),
    );
  }

  if (kind === "SKIP" && !settings.allowPartialDaySkip && slots.length < servedSlots.length) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        "This mess only takes whole days off, not single meals. Select every meal.",
      ),
    );
  }

  // --- Advance notice ---
  //
  // Measured to the moment the FIRST affected meal opens. A cut arriving after
  // the kitchen has shopped and cooked saves nothing, so crediting it would
  // simply be a discount.
  const requiredHours = kind === "AWAY" ? settings.awayAdvanceHours : settings.cutAdvanceHours;
  const earliestOpening = openingOf(request.dateFrom, slots, request);
  if (earliestOpening === null) {
    return err(domainError("VALIDATION_FAILED", "That meal is not served on this day."));
  }

  const noticeGiven = hoursBetween(request.now, earliestOpening);
  if (noticeGiven < requiredHours) {
    const today = serviceDateOf(request.timeZone, request.now);
    const earliestDate = earliestAbsenceDate(today, requiredHours);
    return err(
      domainError(
        "VALIDATION_FAILED",
        `This mess needs ${requiredHours} hours' notice. The earliest you can choose is ${formatDay(earliestDate)}.`,
        { requiredHours, earliest: earliestDate },
      ),
    );
  }

  // --- The monthly cap ---
  //
  // Skips only. Capping an away period is what this design deliberately avoids:
  // a fortnight at home is not over-skipping, and the admin reviews it instead.
  if (kind === "SKIP") {
    const wouldUse = request.daysAlreadyUsedThisMonth + dates.length;
    if (wouldUse > settings.cutMaxDaysPerMonth) {
      const remaining = Math.max(0, settings.cutMaxDaysPerMonth - request.daysAlreadyUsedThisMonth);
      return err(
        domainError(
          "CONFLICT",
          `You can skip ${settings.cutMaxDaysPerMonth} days a month. You have ${remaining} left, and this needs ${dates.length}.`,
          { cap: settings.cutMaxDaysPerMonth, remaining, requested: dates.length },
        ),
      );
    }
  }

  const status: "PENDING" | "APPROVED" =
    kind === "AWAY" && settings.awayRequiresApproval ? "PENDING" : "APPROVED";

  return ok({
    kind,
    dateFrom: request.dateFrom,
    dateTo: request.dateTo,
    mealSlots: slots,
    status,
    days: dates.length,
  });
}

/**
 * When the first affected meal opens on `date`.
 *
 * The caller supplies windows through settings; this resolves them in the
 * tenant's timezone so the notice period is measured against the hostel's
 * clock, never the server's.
 */
function openingOf(
  date: ServiceDate,
  slots: readonly MealSlot[],
  request: AbsenceRequest,
): Date | null {
  const relevant = request.settings.mealWindows.filter((w) => slots.includes(w.slot));
  if (relevant.length === 0) return null;

  const openings = relevant.map(
    (w) => mealWindowOn(request.timeZone, date, { start: w.start, end: w.end }).opensAt,
  );
  return openings.reduce((earliest, o) => (o < earliest ? o : earliest));
}

/**
 * The first date whose earliest meal is far enough away to satisfy the notice.
 *
 * Exported because the date picker's `min` must be this same answer. Two
 * independent calculations would drift, and the student would be refused for
 * choosing a date the form itself offered them.
 */
export function earliestAbsenceDate(today: ServiceDate, requiredHours: number): ServiceDate {
  // Whole days, deliberately: telling a student "choose 12 Aug" is actionable,
  // where "wait another 3 hours and 20 minutes" is not.
  const daysNeeded = Math.max(1, Math.ceil(requiredHours / 24));
  return addDays(today, daysNeeded);
}
