/**
 * Push notification policy (D-34).
 *
 * Push is the only thing this product does that reaches a student who is not
 * using it, so every rule here is a restraint rather than a capability:
 *
 *   * A student who has **left** is never notified. INACTIVE covers both a
 *     student who moved out and one who asked to be deleted (D-32).
 *   * An **opt-out is per kind.** Silencing "tomorrow's menu is up", which
 *     arrives every day, must not silence "your plan has lapsed", which arrives
 *     once and matters.
 *   * A **retry sends nothing.** Every notification carries a dedupe key, and
 *     the database refuses a second delivery under the same one.
 *   * Nothing is sent **in the middle of the night** in the mess's own
 *     timezone.
 *
 * Pure: no I/O, no framework, no Firebase.
 */
import type { StudentStatus, UserRole } from "@/core/domain/enums";
import { domainError, forbidden, type DomainError } from "@/core/errors";
import { err, ok, type Result } from "@/core/result";
import { wallClockTimeOf, type ServiceDate } from "@/core/time";

export const NotificationKind = {
  ANNOUNCEMENT: "ANNOUNCEMENT",
  ABSENCE_DECISION: "ABSENCE_DECISION",
  PLAN_REMINDER: "PLAN_REMINDER",
  MENU_PUBLISHED: "MENU_PUBLISHED",
} as const;

export type NotificationKind = (typeof NotificationKind)[keyof typeof NotificationKind];

export const ALL_NOTIFICATION_KINDS: readonly NotificationKind[] = [
  NotificationKind.ANNOUNCEMENT,
  NotificationKind.ABSENCE_DECISION,
  NotificationKind.PLAN_REMINDER,
  NotificationKind.MENU_PUBLISHED,
];

/**
 * Where each kind takes the reader. A notification that opens the home screen
 * makes them hunt for what they were just told.
 */
const ROUTES: Readonly<Record<NotificationKind, string>> = {
  ANNOUNCEMENT: "/announcements",
  ABSENCE_DECISION: "/absences",
  PLAN_REMINDER: "/plan",
  MENU_PUBLISHED: "/menu",
};

/**
 * Android collapses, and iOS truncates, well before this. Cutting it here means
 * the last thing a student reads is a word and an ellipsis rather than half of
 * one.
 */
const MAX_BODY = 180;

export interface NotificationAudienceMember {
  readonly studentStatus: StudentStatus;
  readonly optOuts: readonly string[];
}

export function wantsNotification(
  kind: NotificationKind,
  member: NotificationAudienceMember,
): boolean {
  // Fails closed on anything that is not plainly a current student.
  if (member.studentStatus === "INACTIVE") return false;
  return !member.optOuts.includes(kind);
}

export interface NotificationInput {
  readonly kind: NotificationKind;
  readonly tenantName: string;
  readonly title: string;
  readonly body: string;
}

export interface PushMessage {
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body: string;
  /** Route inside the app, sent as data so a tap lands somewhere useful. */
  readonly route: string;
}

/**
 * The mess's name leads the title, not ours.
 *
 * A student's notification tray is a list of unrelated apps. "Campus Crave ·
 * Sunday special" is placed instantly; "Sunday special" could be from anything.
 */
export function buildNotification(input: NotificationInput): PushMessage {
  const body = input.body.trim();

  return {
    kind: input.kind,
    title: `${input.tenantName} · ${input.title}`.trim(),
    body: body.length > MAX_BODY ? `${body.slice(0, MAX_BODY - 1).trimEnd()}…` : body,
    route: ROUTES[input.kind],
  };
}

/**
 * What makes one send distinct from another.
 *
 * An announcement is keyed to the announcement, so editing and republishing it
 * does not buzz everyone again. A plan reminder is keyed to the student and the
 * day, because the cron that sends it runs daily and is retried.
 */
export function deliveryKey(
  kind: NotificationKind,
  subject: { readonly id: string; readonly date?: ServiceDate },
): string {
  return subject.date ? `${kind}:${subject.id}:${subject.date}` : `${kind}:${subject.id}`;
}

/** Earliest and latest a phone may be buzzed, in the mess's local time. */
const EARLIEST_HOUR = 7;
const LATEST_HOUR = 21;

/**
 * Whether now is a civil hour to send in.
 *
 * Applied to the scheduled kinds, where the timing is ours to choose. Something
 * a student is waiting on — an away request just decided — is sent when it
 * happens, because that is what they asked for.
 */
export function isWithinSendingHours(timeZone: string, instant: Date): boolean {
  // Through core/time, so the hour is the tenant's and never the server's
  // (rule 9). A UTC comparison here would push at 02:30 in India.
  const [hour] = wallClockTimeOf(timeZone, instant).split(":");
  const localHour = Number(hour);

  return localHour >= EARLIEST_HOUR && localHour < LATEST_HOUR;
}

/**
 * A title long enough to be read at a glance and short enough to survive one.
 * Android shows roughly 45 characters collapsed; past that it is truncated by
 * the OS and the admin never sees what the student saw.
 */
const MAX_TITLE = 80;

export interface ManualNotificationInput {
  readonly actorRole: UserRole;
  readonly title: string;
  readonly body: string;
}

export interface ManualNotification {
  readonly title: string;
  readonly body: string;
}

/**
 * Validates a notification an admin has typed by hand.
 *
 * Authorization first: writing to every student's lock screen is an authority
 * counter staff do not have, and unlike almost everything else in this product
 * it cannot be taken back once sent.
 */
export function parseManualNotification(
  input: ManualNotificationInput,
): Result<ManualNotification, DomainError> {
  if (input.actorRole !== "ADMIN" && input.actorRole !== "SUPER_ADMIN") {
    return err(forbidden("Only an admin can send a notification."));
  }

  const title = input.title.trim();
  const body = input.body.trim();

  if (title.length === 0) return err(domainError("VALIDATION_FAILED", "Give it a title."));
  if (title.length > MAX_TITLE) {
    return err(domainError("VALIDATION_FAILED", `Keep the title under ${MAX_TITLE} characters.`));
  }
  // The body is truncated for display by `buildNotification`, but an empty one
  // is a buzz with nothing in it.
  if (body.length === 0) return err(domainError("VALIDATION_FAILED", "Write a message."));
  if (body.length > 500) {
    return err(domainError("VALIDATION_FAILED", "Keep the message under 500 characters."));
  }

  return ok({ title, body });
}
