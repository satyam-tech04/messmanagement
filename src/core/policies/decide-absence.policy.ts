/**
 * Deciding an away request (§7.1).
 *
 * A skip is self-service; a period away goes to the mess office, both because
 * it is uncapped and because the kitchen wants warning of a large drop in the
 * headcount. This is the rule set for that decision.
 *
 * Three guards, each protecting something specific:
 *
 *   * **PENDING only.** Deciding an already-decided request would move a row
 *     out of a state the Phase 2 ledger depends on, and re-approving one the
 *     student has withdrawn would mark them absent from meals they intend to eat.
 *   * **A rejection states why.** The student needs something to act on, and
 *     `mess_cuts_rejection_has_reason` refuses the write regardless.
 *   * **No approving a period that has entirely passed.** The food was cooked
 *     while the request sat unreviewed. Approving now removes nothing from any
 *     headcount — it only manufactures a credit for meals that were served.
 */
import type { MessCutStatus, UserRole } from "../domain/enums";
import { domainError, forbidden, illegalTransition, type DomainError } from "../errors";
import { err, ok, type Result } from "../result";
import { compareServiceDates, type ServiceDate } from "../time";

export interface AbsenceDecision {
  readonly actorRole: UserRole;
  readonly currentStatus: MessCutStatus;
  readonly outcome: "APPROVED" | "REJECTED";
  readonly reason: string;
  readonly dateFrom: ServiceDate;
  readonly dateTo: ServiceDate;
  /** Today in the tenant's timezone — never `new Date()` here (rule 9). */
  readonly today: ServiceDate;
}

export interface AbsenceDecisionDraft {
  readonly status: "APPROVED" | "REJECTED";
  /** Null on approval: a reason on an approved row reads as a rejection. */
  readonly reason: string | null;
  readonly from: MessCutStatus;
  readonly to: MessCutStatus;
}

export function decideAbsence(input: AbsenceDecision): Result<AbsenceDecisionDraft, DomainError> {
  // First, so an unauthorized actor cannot learn from the error whether the
  // request had already been decided.
  if (input.actorRole !== "ADMIN" && input.actorRole !== "SUPER_ADMIN") {
    return err(forbidden("Only an admin can decide an absence request."));
  }

  if (input.currentStatus !== "PENDING") {
    return err(
      illegalTransition(
        `This request is already ${input.currentStatus.toLowerCase()}.`,
        input.currentStatus,
        input.outcome,
      ),
    );
  }

  const reason = input.reason.trim();

  if (input.outcome === "REJECTED" && reason.length === 0) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        "Say why you are turning this down — the student sees this and has nothing else to go on.",
      ),
    );
  }

  // Rejecting a past period is still allowed: the student is owed an answer
  // either way, and a stale pending row is worse than a decided one.
  if (input.outcome === "APPROVED" && compareServiceDates(input.dateTo, input.today) < 0) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        "Those days have already passed, so approving this saves nothing — the food was cooked. Reject it, or raise a credit once billing is live.",
        { dateTo: input.dateTo, today: input.today },
      ),
    );
  }

  return ok({
    status: input.outcome,
    reason: input.outcome === "REJECTED" ? reason : null,
    from: input.currentStatus,
    to: input.outcome,
  });
}
