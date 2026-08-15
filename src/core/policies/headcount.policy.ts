/**
 * Headcount projection (architecture doc §8).
 *
 *   projected(date, slot) =
 *       count(students with ACTIVE subscription covering date & slot, not BLOCKED)
 *     − count(approved mess_cuts covering date & slot)
 *     + count(guest tokens purchased for date & slot)
 *     + count(extra plates purchased for date & slot)
 *
 * This is the number the kitchen cooks to, and the reason the advance-notice
 * rule exists at all — the cutoff is what makes the count freezable. Post
 * service, projected vs actual gives the variance report, which is the single
 * most valuable analytic to hand a mess owner.
 *
 * Pure: it receives already-fetched rows and returns a number plus the
 * breakdown that produced it. The breakdown matters — an owner will not trust a
 * bare number, and "412 = 430 subscribed − 22 on cut + 4 guests" is auditable
 * where "412" is not.
 */

import type { MealSlot, StudentStatus, SubscriptionStatus } from "../domain/enums";
import { isWithinDateRange, type ServiceDate } from "../time";

/** The subscription facts needed to decide whether a student eats on a date. */
export interface SubscriberSnapshot {
  readonly studentId: string;
  readonly studentStatus: StudentStatus;
  readonly subscriptionStatus: SubscriptionStatus;
  readonly startDate: ServiceDate;
  readonly endDate: ServiceDate;
  /** The slots snapshotted onto the subscription, not the plan's current ones. */
  readonly includedMealSlots: readonly MealSlot[];
}

export interface MessCutSnapshot {
  readonly studentId: string;
  readonly dateFrom: ServiceDate;
  readonly dateTo: ServiceDate;
  readonly mealSlots: readonly MealSlot[];
  /**
   * Only APPROVED and CREDITED cuts remove a plate from the count.
   *
   * PENDING matters most here: an away request awaiting an admin's decision
   * must NOT reduce the headcount, or a student could cut the kitchen's order
   * simply by asking.
   */
  readonly status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "CREDITED";
}

export interface HeadcountInput {
  readonly serviceDate: ServiceDate;
  readonly mealSlot: MealSlot;
  readonly subscribers: readonly SubscriberSnapshot[];
  readonly messCuts: readonly MessCutSnapshot[];
  readonly guestTokens?: number;
  readonly extraPlates?: number;
}

export interface HeadcountProjection {
  readonly serviceDate: ServiceDate;
  readonly mealSlot: MealSlot;
  /** The number to cook to. Never negative. */
  readonly projectedCount: number;
  readonly guestCount: number;
  readonly extraPlateCount: number;
  /** Auditable breakdown — this is what makes the number defensible. */
  readonly breakdown: {
    readonly eligibleSubscribers: number;
    readonly onMessCut: number;
    readonly guestTokens: number;
    readonly extraPlates: number;
  };
}

/**
 * Whether a subscription entitles this student to this meal on this date.
 *
 * A BLOCKED student is excluded: they cannot generate a QR code, so cooking for
 * them wastes food. A GRACE student is still included — they are inside the
 * grace period and will be served (§7.4).
 */
export function isEligibleForMeal(
  subscriber: SubscriberSnapshot,
  serviceDate: ServiceDate,
  mealSlot: MealSlot,
): boolean {
  if (subscriber.subscriptionStatus !== "ACTIVE") return false;
  if (subscriber.studentStatus === "BLOCKED" || subscriber.studentStatus === "INACTIVE") {
    return false;
  }
  if (!isWithinDateRange(serviceDate, subscriber.startDate, subscriber.endDate)) return false;
  return subscriber.includedMealSlots.includes(mealSlot);
}

/** Whether an approved cut removes this student from this specific meal. */
export function isCutFromMeal(
  cut: MessCutSnapshot,
  serviceDate: ServiceDate,
  mealSlot: MealSlot,
): boolean {
  if (cut.status !== "APPROVED" && cut.status !== "CREDITED") return false;
  if (!isWithinDateRange(serviceDate, cut.dateFrom, cut.dateTo)) return false;
  // Per-slot rather than per-day: a cut listing only LUNCH must not remove the
  // student from dinner. Whole-day cuts are simply the case where the array
  // holds every served slot (decision D-06 keeps both shapes open).
  return cut.mealSlots.includes(mealSlot);
}

export function projectHeadcount(input: HeadcountInput): HeadcountProjection {
  // Deduplicate by student. A data anomaly that produced two active
  // subscription rows for one student must not double-count a plate — the
  // database's partial unique index prevents it, but the projection is what
  // the kitchen acts on, so it defends itself too.
  const eligible = new Set<string>();
  for (const subscriber of input.subscribers) {
    if (isEligibleForMeal(subscriber, input.serviceDate, input.mealSlot)) {
      eligible.add(subscriber.studentId);
    }
  }

  const cut = new Set<string>();
  for (const messCut of input.messCuts) {
    if (!isCutFromMeal(messCut, input.serviceDate, input.mealSlot)) continue;
    // Only subtract students who were being counted in the first place. A cut
    // by an already-excluded student would otherwise push the count below the
    // true figure.
    if (eligible.has(messCut.studentId)) cut.add(messCut.studentId);
  }

  const guestTokens = Math.max(0, input.guestTokens ?? 0);
  const extraPlates = Math.max(0, input.extraPlates ?? 0);
  const subscriberPlates = eligible.size - cut.size;

  return {
    serviceDate: input.serviceDate,
    mealSlot: input.mealSlot,
    projectedCount: Math.max(0, subscriberPlates + guestTokens + extraPlates),
    guestCount: guestTokens,
    extraPlateCount: extraPlates,
    breakdown: {
      eligibleSubscribers: eligible.size,
      onMessCut: cut.size,
      guestTokens,
      extraPlates,
    },
  };
}

// ---------------------------------------------------------------------------
// Variance
// ---------------------------------------------------------------------------

export interface VarianceReport {
  readonly serviceDate: ServiceDate;
  readonly mealSlot: MealSlot;
  readonly projectedCount: number;
  readonly actualCount: number;
  /** actual − projected. Negative means food was cooked and not eaten. */
  readonly variance: number;
  /** Variance as a share of the projection, rounded to one decimal place. */
  readonly variancePercent: number;
}

/**
 * Compares what the kitchen cooked against what was actually served.
 *
 * Persistent variance in one direction is the actionable signal: consistently
 * negative means the mess is over-cooking and wasting money every single day,
 * which is exactly the finding that justifies the subscription price.
 */
export function calculateVariance(
  serviceDate: ServiceDate,
  mealSlot: MealSlot,
  projectedCount: number,
  actualCount: number,
): VarianceReport {
  const variance = actualCount - projectedCount;
  // Guard the divide: an empty projection with real attendance is a genuine
  // event (someone ate before the snapshot locked), not a crash.
  const variancePercent =
    projectedCount === 0
      ? actualCount === 0
        ? 0
        : 100
      : Math.round((variance / projectedCount) * 1000) / 10;

  return { serviceDate, mealSlot, projectedCount, actualCount, variance, variancePercent };
}
