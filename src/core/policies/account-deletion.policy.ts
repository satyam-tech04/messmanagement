/**
 * Account deletion policy (D-32).
 *
 * Both stores require a student to be able to start deleting their account from
 * inside the app, and our published policy at /delete-account promises what
 * follows: access stops at once, and the personal data is erased within 30 days
 * while the mess keeps its accounts.
 *
 * Two rules shape everything here:
 *
 *   1. **Erasure anonymises, it never deletes rows.** `profiles.id` cascades
 *      from `auth.users`, `students.profile_id` cascades from `profiles`, and
 *      attendance, subscriptions and bills cascade from `students`. Deleting the
 *      login would therefore take a year of the mess's accounts with it. So the
 *      rows stay and the person is written out of them.
 *   2. **Only a student may ask.** Admins and staff do not own their logins —
 *      the mess does — and an admin who erased themselves from a phone would
 *      leave a hostel with no way back in.
 *
 * Pure: no I/O, no framework. The service decides nothing, it only applies this.
 */
import type { UserRole } from "@/core/domain/enums";
import { forbidden, illegalTransition, type DomainError } from "@/core/errors";
import { err, ok, type Result } from "@/core/result";
import { addDays, type ServiceDate } from "@/core/time";

export const DeletionRequestStatus = {
  REQUESTED: "REQUESTED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;

export type DeletionRequestStatus =
  (typeof DeletionRequestStatus)[keyof typeof DeletionRequestStatus];

/**
 * What /delete-account promises, in days. Changing this changes a published
 * commitment, so it lives here rather than being written into a query.
 */
export const DELETION_WINDOW_DAYS = 30;

/** The name an erased profile carries, read by whoever opens the admin list. */
export const DELETED_NAME = "Deleted account";

/** Roll numbers are unique and NOT NULL, so erasure replaces rather than clears. */
export const DELETED_ROLL_PREFIX = "DELETED-";

/**
 * REQUESTED is the only live state; both exits are terminal.
 *
 * Nothing follows COMPLETED because there is no longer any data to act on, and
 * a cancelled request must never be quietly completed later — the student was
 * told it was called off.
 */
const TRANSITIONS: Readonly<Record<DeletionRequestStatus, readonly DeletionRequestStatus[]>> = {
  REQUESTED: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionDeletionRequest(
  from: DeletionRequestStatus,
  to: DeletionRequestStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

/** The date the mess has until, counted in the tenant's own day (rule 9). */
export function erasureDueDate(requestedOn: ServiceDate): ServiceDate {
  return addDays(requestedOn, DELETION_WINDOW_DAYS);
}

export interface OpenDeletionRequest {
  readonly id: string;
  readonly status: DeletionRequestStatus;
  readonly eraseBy: string;
}

export interface DeletionRequestInput {
  readonly actorRole: UserRole;
  /** The student's existing open request, if they already asked. */
  readonly openRequest: OpenDeletionRequest | null;
  readonly today: ServiceDate;
}

export interface DeletionRequestDecision {
  readonly eraseBy: string;
  /**
   * True when this tap found a request already open. The caller reports success
   * either way — a retry is not an error — but writes nothing new.
   */
  readonly alreadyRequested: boolean;
}

/**
 * Decides what a "delete my account" tap means.
 *
 * A second tap returns the **original** deadline. Refreshing it would let a
 * student keep their data alive indefinitely by asking again every day, which
 * is the opposite of what they asked for.
 */
export function requestDeletion(
  input: DeletionRequestInput,
): Result<DeletionRequestDecision, DomainError> {
  if (input.actorRole !== "STUDENT") {
    return err(
      forbidden(
        "Only a student can delete their own account. Mess logins are managed by the mess.",
      ),
    );
  }

  if (input.openRequest && input.openRequest.status === "REQUESTED") {
    return ok({ eraseBy: input.openRequest.eraseBy, alreadyRequested: true });
  }

  return ok({ eraseBy: erasureDueDate(input.today), alreadyRequested: false });
}

export interface DeletionDecisionInput {
  readonly actorRole: UserRole;
  readonly current: DeletionRequestStatus;
}

/**
 * Authorization first, then the state machine — so an actor who may not erase
 * anyone cannot use the error code to learn whether a given student asked.
 */
function decide(
  input: DeletionDecisionInput,
  next: DeletionRequestStatus,
  verb: string,
): Result<DeletionRequestStatus, DomainError> {
  if (input.actorRole !== "ADMIN" && input.actorRole !== "SUPER_ADMIN") {
    return err(forbidden(`Only an admin can ${verb} an account deletion.`));
  }

  if (!canTransitionDeletionRequest(input.current, next)) {
    return err(illegalTransition("account deletion", input.current, next));
  }

  return ok(next);
}

export function completeDeletion(
  input: DeletionDecisionInput,
): Result<DeletionRequestStatus, DomainError> {
  return decide(input, "COMPLETED", "complete");
}

export function cancelDeletion(
  input: DeletionDecisionInput,
): Result<DeletionRequestStatus, DomainError> {
  return decide(input, "CANCELLED", "cancel");
}

export interface RedactedIdentity {
  readonly fullName: string;
  readonly phone: null;
  readonly email: null;
  readonly photoUrl: null;
  readonly rollNumber: string;
  readonly roomNumber: null;
  readonly block: null;
}

/**
 * Exactly what an erased student's rows are set to.
 *
 * Derived from the student id rather than a random value or a clock, so a
 * retried erasure computes the same row and writes nothing new (rule 5). The id
 * is already in every attendance row the mess keeps, so using it here reveals
 * nothing that erasure was meant to remove — but it is short enough not to read
 * as a key, and it never appears beside a name again.
 */
export function redactedIdentity(studentId: string): RedactedIdentity {
  const discriminator = studentId.replace(/-/g, "").slice(0, 8).toUpperCase();

  if (discriminator.length === 0) {
    // A student id is a uuid; an empty one means the caller passed something
    // that is not a student, and a blank roll number violates its constraint.
    throw new Error("Cannot redact an identity without a student id");
  }

  return {
    fullName: DELETED_NAME,
    phone: null,
    email: null,
    photoUrl: null,
    rollNumber: `${DELETED_ROLL_PREFIX}${discriminator}`,
    roomNumber: null,
    block: null,
  };
}
