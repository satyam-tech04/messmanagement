/**
 * Student administration policy.
 *
 * The rules an admin screen must obey when editing a student: who may change a
 * status, which transitions exist, and how a subscription period is derived.
 * Pure — no I/O, no framework. The Server Action calls this and maps the result.
 */
import { canTransitionStudentStatus, type StudentStatus, type UserRole } from "@/core/domain/enums";
import { domainError, forbidden, illegalTransition, type DomainError } from "@/core/errors";
import { err, ok, type Result } from "@/core/result";
import { addDays, serviceDateOf, type ServiceDate } from "@/core/time";

export interface StatusChangeRequest {
  readonly actorRole: UserRole;
  readonly current: StudentStatus;
  readonly next: StudentStatus;
  /** Free text, shown verbatim in the audit log. */
  readonly reason: string;
}

export interface StatusChange {
  readonly from: StudentStatus;
  readonly to: StudentStatus;
  readonly reason: string;
}

/**
 * Validates a status change end to end.
 *
 * Order matters: authorization is checked **first**, so an actor who may not
 * change statuses gets FORBIDDEN whatever they asked for and cannot use the
 * error code to map out the state machine.
 */
export function changeStudentStatus(
  request: StatusChangeRequest,
): Result<StatusChange, DomainError> {
  const { actorRole, current, next } = request;

  // Staff verify attendance at the counter. Deciding who is allowed to eat is a
  // different authority, and conflating the two would let counter staff quietly
  // unblock a friend.
  if (actorRole !== "ADMIN" && actorRole !== "SUPER_ADMIN") {
    return err(forbidden("Only an admin can change a student's status."));
  }

  if (current === next) {
    return err(
      domainError("VALIDATION_FAILED", `The student is already ${current}.`, { status: current }),
    );
  }

  if (!canTransitionStudentStatus(current, next)) {
    return err(illegalTransition("Student", current, next));
  }

  const reason = request.reason.trim();
  if (reason.length === 0) {
    // When a student disputes being blocked months later, "who changed this and
    // why" is the whole answer. An optional field would be left blank.
    return err(domainError("VALIDATION_FAILED", "Give a reason for this status change."));
  }

  return ok({ from: current, to: next, reason });
}

export interface SubscriptionPeriodRequest {
  /** IANA zone of the tenant, e.g. "Asia/Kolkata". */
  readonly timeZone: string;
  readonly now: Date;
  readonly durationDays: number;
  /** Overrides "today" when backdating an activation. */
  readonly startDate?: ServiceDate;
}

export interface SubscriptionPeriod {
  readonly startDate: ServiceDate;
  readonly endDate: ServiceDate;
}

/**
 * Derives a subscription's inclusive date range.
 *
 * Exists so no caller is ever tempted to write `toISOString().slice(0, 10)` —
 * which converts local to UTC first and, for an IST hostel, shifts the date back
 * a day for most of the working day. That bug has already been shipped twice in
 * this repository (rule 9, architecture §2.9).
 *
 * The range is **inclusive**: a 30-day plan starting on the 1st ends on the
 * 30th, so `durationDays - 1` is added, not `durationDays`.
 */
export function subscriptionPeriodFor(request: SubscriptionPeriodRequest): SubscriptionPeriod {
  const { timeZone, now, durationDays } = request;

  if (!Number.isInteger(durationDays) || durationDays < 1) {
    throw new RangeError(`durationDays must be a positive integer, received ${durationDays}`);
  }

  const startDate = request.startDate ?? serviceDateOf(timeZone, now);
  return { startDate, endDate: addDays(startDate, durationDays - 1) };
}
