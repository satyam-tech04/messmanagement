/**
 * The real state of a subscription, derived rather than trusted.
 *
 * `subscriptions.status` is written when something happens to a row —
 * activation, cancellation — but nothing writes to it merely because time
 * passed. The architecture doc's `expire-subscriptions` job is Phase 2, so
 * until then a finished plan sits at ACTIVE indefinitely.
 *
 * Rather than let every screen re-derive that (and disagree), this is the one
 * place that answers "is this plan actually running today?". The eligibility
 * check already compares dates, so the counter was always correct — it was the
 * *screens* and the *assign flow* that trusted the column and misled people.
 *
 * When the Phase 2 job lands it will simply make the column agree with what
 * this already reports; nothing here needs to change.
 */
import { compareServiceDates, type ServiceDate } from "@/core/time";

export type SubscriptionState = "SCHEDULED" | "RUNNING" | "EXPIRED" | "CANCELLED";

export interface SubscriptionDates {
  readonly status: string;
  readonly startDate: ServiceDate;
  readonly endDate: ServiceDate;
}

export function subscriptionStateOf(
  subscription: SubscriptionDates,
  today: ServiceDate,
): SubscriptionState {
  // A deliberate end beats the calendar: a plan cancelled mid-period is over
  // even though its dates still cover today.
  if (subscription.status === "CANCELLED") return "CANCELLED";
  if (subscription.status === "EXPIRED") return "EXPIRED";

  // Inclusive at both ends — a 30-day plan from the 1st runs through the 30th.
  if (compareServiceDates(today, subscription.startDate) < 0) return "SCHEDULED";
  if (compareServiceDates(today, subscription.endDate) > 0) return "EXPIRED";

  return "RUNNING";
}

/**
 * Whether a new plan may take this one's place without an explicit cancellation.
 *
 * Only true for a subscription that is already over. Ending a plan that is
 * still running — or one deliberately scheduled to start later — is a real
 * decision with a reason attached, and must never happen as a side effect of
 * assigning another.
 */
export function isReplaceable(subscription: SubscriptionDates | null, today: ServiceDate): boolean {
  if (!subscription) return true;
  const state = subscriptionStateOf(subscription, today);
  return state === "EXPIRED" || state === "CANCELLED";
}

/** Human label for a derived state, used wherever a subscription is shown. */
export function subscriptionStateLabel(state: SubscriptionState): string {
  switch (state) {
    case "RUNNING":
      return "Active";
    case "SCHEDULED":
      return "Starts later";
    case "EXPIRED":
      return "Expired";
    case "CANCELLED":
      return "Cancelled";
  }
}
