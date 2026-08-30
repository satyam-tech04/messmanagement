/**
 * Student feedback on a meal (NF-4c).
 *
 * ## This relaxes the read-only rule, deliberately
 *
 * The owner's standing constraint is that a student may only show their QR and
 * view things. Feedback is the one exception they asked for, because it cannot
 * work any other way — the person who ate the food is the only one who can rate
 * it. It is therefore the *single* student input in the product, it is gated by
 * a per-mess toggle that defaults to off, and it changes nothing operational:
 * no eligibility, no attendance, no headcount, no money.
 *
 * ## One verdict per meal
 *
 * A student rates a given meal on a given day once. Re-submitting replaces
 * their answer rather than adding a second, enforced by a unique index rather
 * than an application check — otherwise the admin's averages could be moved by
 * whoever taps hardest.
 */
import type { MealSlot, UserRole } from "@/core/domain/enums";
import { domainError, forbidden, type DomainError } from "@/core/errors";
import { err, ok, type Result } from "@/core/result";
import { compareServiceDates, differenceInDays, type ServiceDate } from "@/core/time";

const MAX_COMMENT = 1000;

/**
 * How far back a student may comment.
 *
 * Long enough to catch somebody who eats and remembers that evening, short
 * enough that a rating is about a meal the person actually remembers. Ratings
 * dribbling in about a month-old lunch would make the admin's averages describe
 * nothing in particular.
 */
const MAX_LOOKBACK_DAYS = 7;

export interface FeedbackDraftInput {
  readonly actorRole: UserRole;
  /** The mess's toggle. Checked here so a hidden form is not the only guard. */
  readonly featureEnabled: boolean;
  readonly rating: number;
  readonly comment: string;
  readonly serviceDate: ServiceDate;
  readonly mealSlot: MealSlot;
  readonly today: ServiceDate;
}

export interface FeedbackDraft {
  readonly rating: number;
  readonly comment: string | null;
  readonly serviceDate: ServiceDate;
  readonly mealSlot: MealSlot;
}

export function parseFeedbackDraft(input: FeedbackDraftInput): Result<FeedbackDraft, DomainError> {
  // The toggle is a real permission, not a display preference. A student whose
  // mess has feedback switched off must be refused even if the request arrives
  // by some other route than the form.
  if (!input.featureEnabled) {
    return err(forbidden("This mess is not collecting feedback at the moment."));
  }

  // Students rate their own meals; staff and admins may record what somebody
  // told them at the counter, which is where most of it will be said.
  if (
    input.actorRole !== "STUDENT" &&
    input.actorRole !== "STAFF" &&
    input.actorRole !== "ADMIN" &&
    input.actorRole !== "SUPER_ADMIN"
  ) {
    return err(forbidden("You cannot leave feedback."));
  }

  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    return err(domainError("VALIDATION_FAILED", "Choose between one and five stars."));
  }

  const comment = input.comment.trim();
  if (comment.length > MAX_COMMENT) {
    return err(domainError("VALIDATION_FAILED", "That comment is too long."));
  }

  // Nobody has an opinion about tomorrow's lunch.
  if (compareServiceDates(input.serviceDate, input.today) > 0) {
    return err(domainError("VALIDATION_FAILED", "That meal has not been served yet."));
  }
  if (differenceInDays(input.serviceDate, input.today) > MAX_LOOKBACK_DAYS) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `Feedback is only open for ${MAX_LOOKBACK_DAYS} days after a meal.`,
      ),
    );
  }

  return ok({
    rating: input.rating,
    comment: comment.length > 0 ? comment : null,
    serviceDate: input.serviceDate,
    mealSlot: input.mealSlot,
  });
}

// ---------------------------------------------------------------------------
// Summaries for the admin
// ---------------------------------------------------------------------------

/**
 * Mean rating to one decimal place, or null when nobody has said anything.
 *
 * Null rather than zero, deliberately: a zero on a dashboard reads as "everyone
 * hated it", which is the opposite of "nobody has commented yet".
 */
export function averageRating(ratings: readonly number[]): number | null {
  if (ratings.length === 0) return null;
  const total = ratings.reduce((sum, r) => sum + r, 0);
  return Math.round((total / ratings.length) * 10) / 10;
}

export type RatingBreakdown = Record<1 | 2 | 3 | 4 | 5, number>;

/** How many of each star. Levels nobody chose are present as zero, not missing. */
export function ratingBreakdown(ratings: readonly number[]): RatingBreakdown {
  const counts: RatingBreakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const rating of ratings) {
    if (rating >= 1 && rating <= 5 && Number.isInteger(rating)) {
      counts[rating as 1 | 2 | 3 | 4 | 5] += 1;
    }
  }
  return counts;
}
