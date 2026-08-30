/**
 * Special-meal announcements (NF-4a).
 *
 * The mess owner posts "Onam Sadhya this Sunday"; every student in that mess
 * sees it on their own screen; nothing else happens. Per D-19 there is no
 * opt-in, no headcount, no charge, and no effect on eligibility or the QR flow.
 * A mess that charges for a special meal rings it up through counter sales.
 *
 * ## Visibility is derived, never stored
 *
 * There is no cron in this system beyond the headcount snapshot, so nothing
 * would flip a column when a date arrives. An announcement therefore appears
 * and disappears purely from its date window — the same reasoning as
 * `subscription-state.ts` and `pause.policy.ts`, and the reason "it expires on
 * its own" is true rather than aspirational.
 *
 * The window is **inclusive at both ends**, unlike a pause: an announcement
 * about Sunday lunch must still be on screen on Sunday.
 */
import type { MealSlot, UserRole } from "@/core/domain/enums";
import { domainError, forbidden, type DomainError } from "@/core/errors";
import { err, ok, type Result } from "@/core/result";
import { compareServiceDates, type ServiceDate } from "@/core/time";

const MAX_TITLE = 120;
const MAX_BODY = 2000;

function isAdmin(role: UserRole): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

export type AnnouncementState = "SCHEDULED" | "LIVE" | "FINISHED" | "ARCHIVED";

/** The stored shape. `status` holds only what an admin decided. */
export interface AnnouncementDates {
  readonly status: string;
  readonly startsOn: ServiceDate;
  readonly endsOn: ServiceDate;
}

export function announcementStateOf(
  announcement: AnnouncementDates,
  today: ServiceDate,
): AnnouncementState {
  // A withdrawal beats the calendar, exactly as a cancellation does elsewhere.
  if (announcement.status === "ARCHIVED") return "ARCHIVED";
  if (compareServiceDates(today, announcement.startsOn) < 0) return "SCHEDULED";
  if (compareServiceDates(today, announcement.endsOn) > 0) return "FINISHED";
  return "LIVE";
}

export function announcementStateLabel(state: AnnouncementState): string {
  switch (state) {
    case "SCHEDULED":
      return "Scheduled";
    case "LIVE":
      return "Showing now";
    case "FINISHED":
      return "Finished";
    case "ARCHIVED":
      return "Withdrawn";
  }
}

/** Whether a student should see this today. The only question the student screen asks. */
export function isAnnouncementVisibleOn(
  announcement: AnnouncementDates,
  today: ServiceDate,
): boolean {
  return announcementStateOf(announcement, today) === "LIVE";
}

/**
 * Filters to what is on screen today.
 *
 * Returns an array, empty when nothing is live — the student screen then renders
 * nothing at all rather than an empty card, because that screen is held up at a
 * counter and every row on it costs attention.
 */
export function visibleAnnouncements<T extends AnnouncementDates>(
  announcements: readonly T[],
  today: ServiceDate,
): T[] {
  return announcements.filter((a) => isAnnouncementVisibleOn(a, today));
}

// ---------------------------------------------------------------------------
// Creating and editing
// ---------------------------------------------------------------------------

export interface AnnouncementDraftInput {
  readonly actorRole: UserRole;
  readonly title: string;
  readonly body: string;
  readonly startsOn: ServiceDate;
  readonly endsOn: ServiceDate;
  /** The day the special meal is served, when it is about one particular day. */
  readonly serviceDate?: ServiceDate;
  readonly mealSlot?: MealSlot;
}

export interface AnnouncementDraft {
  readonly title: string;
  readonly body: string | null;
  readonly startsOn: ServiceDate;
  readonly endsOn: ServiceDate;
  readonly serviceDate: ServiceDate | null;
  readonly mealSlot: MealSlot | null;
}

export function parseAnnouncementDraft(
  input: AnnouncementDraftInput,
): Result<AnnouncementDraft, DomainError> {
  if (!isAdmin(input.actorRole)) {
    return err(forbidden("Only an admin can post an announcement."));
  }

  const title = input.title.trim();
  if (title.length === 0) {
    return err(domainError("VALIDATION_FAILED", "Give the announcement a title."));
  }
  if (title.length > MAX_TITLE) {
    return err(domainError("VALIDATION_FAILED", "That title is too long."));
  }

  const body = input.body.trim();
  if (body.length > MAX_BODY) {
    return err(domainError("VALIDATION_FAILED", "That description is too long."));
  }

  if (compareServiceDates(input.endsOn, input.startsOn) < 0) {
    return err(
      domainError("VALIDATION_FAILED", "The last day to show it cannot be before the first."),
    );
  }

  // A start date in the past is deliberately allowed: posting today about today
  // is the ordinary case, and a mess should not have to think about windows to
  // do it.

  return ok({
    title,
    // Null rather than "" so "has a description" is one check everywhere.
    body: body.length > 0 ? body : null,
    startsOn: input.startsOn,
    endsOn: input.endsOn,
    serviceDate: input.serviceDate ?? null,
    mealSlot: input.mealSlot ?? null,
  });
}
