/**
 * Account deletion — request, cancel, complete (D-32).
 *
 * `account-deletion.policy.ts` decides; these use cases own the **ordering**,
 * and the ordering is the part that can hurt a real person:
 *
 *   * **Record the request before revoking access.** The other way round leaves
 *     a student locked out of their meals with nothing on file to undo, and no
 *     admin able to tell why.
 *   * **Erase before closing the request.** A request closed first, whose
 *     erasure then failed, would be recorded as done while the student's name
 *     was still in the database — and nothing would ever come back to finish
 *     it. Erasure is idempotent (it writes derived values), so the retry after
 *     a crash is safe; a lost erasure is not.
 *
 * Fails closed (rule 7): no holder, no request, wrong tenant — nothing happens.
 */
import type { TenantContext } from "../domain/tenant-context";
import { forbidden, infrastructureError, notFound, type DomainError } from "../errors";
import {
  cancelDeletion,
  completeDeletion,
  redactedIdentity,
  requestDeletion,
  type DeletionRequestDecision,
} from "../policies/account-deletion.policy";
import type { AccountDeletionRepository, DeletionRequestRow } from "../ports/repositories";
import { err, isErr, ok, type Result } from "../result";
import { serviceDateOf } from "../time";

export interface AccountDeletionDeps {
  readonly repo: AccountDeletionRepository;
  readonly now: () => Date;
}

/** Postgres unique violation — the partial index is the idempotency guarantee. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export interface AccountDeletionRequested extends DeletionRequestDecision {
  readonly requestId: string;
}

/**
 * A student confirms "delete my account".
 *
 * Access ends here, not in 30 days: `profiles.status = 'DISABLED'` is what
 * every endpoint resolves against, so the tokens already on the phone stop
 * working on their next request.
 */
export async function requestAccountDeletion(
  ctx: TenantContext,
  deps: AccountDeletionDeps,
): Promise<Result<AccountDeletionRequested, DomainError>> {
  const existing = await deps.repo.openRequestFor(ctx.tenantId, ctx.actorProfileId);

  const today = serviceDateOf(ctx.timezone, deps.now());
  const decision = requestDeletion({
    actorRole: ctx.role,
    openRequest: existing
      ? { id: existing.id, status: existing.status, eraseBy: existing.eraseBy }
      : null,
    today,
  });

  if (isErr(decision)) return decision;

  if (decision.value.alreadyRequested && existing) {
    return ok({ ...decision.value, requestId: existing.id });
  }

  const holder = await deps.repo.holderOf(ctx.tenantId, ctx.actorProfileId);
  if (!holder) return err(notFound("account"));

  let created: DeletionRequestRow;
  try {
    created = await deps.repo.create({
      tenantId: ctx.tenantId,
      profileId: ctx.actorProfileId,
      studentId: holder.studentId,
      eraseBy: decision.value.eraseBy,
      previousProfileStatus: holder.profileStatus,
      previousStudentStatus: holder.studentStatus,
    });
  } catch (error) {
    // Two taps raced and the index caught the loser. The student asked to be
    // deleted and they are being deleted, so this is a success, not an error.
    if (isUniqueViolation(error)) {
      const won = await deps.repo.openRequestFor(ctx.tenantId, ctx.actorProfileId);
      if (won) return ok({ eraseBy: won.eraseBy, alreadyRequested: true, requestId: won.id });
    }
    return err(infrastructureError("Could not record the deletion request."));
  }

  await deps.repo.setAccess(ctx.tenantId, ctx.actorProfileId, {
    profileStatus: "DISABLED",
    // A student who has asked to leave is not eating here tomorrow; the
    // headcount and the counter both key off this.
    studentStatus: holder.studentStatus ? "INACTIVE" : null,
  });

  return ok({ ...decision.value, requestId: created.id });
}

/** Loads a request and proves it belongs to the caller's mess (rule 8). */
async function requestOf(
  ctx: TenantContext,
  requestId: string,
  deps: AccountDeletionDeps,
): Promise<Result<DeletionRequestRow, DomainError>> {
  if (ctx.role !== "ADMIN" && ctx.role !== "SUPER_ADMIN") {
    return err(forbidden("Only an admin can decide an account deletion."));
  }

  const row = await deps.repo.byId(ctx.tenantId, requestId);
  // Not "forbidden": an admin of another mess must not be able to tell the
  // difference between a request that is not theirs and one that never existed.
  if (!row || row.tenantId !== ctx.tenantId) return err(notFound("deletion request"));

  return ok(row);
}

/**
 * An admin completes a deletion: the student is written out of their rows and
 * the request is closed.
 */
export async function completeAccountDeletion(
  ctx: TenantContext,
  input: { readonly requestId: string; readonly note?: string | null },
  deps: AccountDeletionDeps,
): Promise<Result<DeletionRequestRow, DomainError>> {
  const found = await requestOf(ctx, input.requestId, deps);
  if (isErr(found)) return found;

  const decision = completeDeletion({ actorRole: ctx.role, current: found.value.status });
  if (isErr(decision)) return decision;

  const subject = found.value.studentId ?? found.value.profileId;
  await deps.repo.eraseIdentity(ctx.tenantId, {
    profileId: found.value.profileId,
    studentId: found.value.studentId,
    redacted: redactedIdentity(subject),
  });

  const closed = await deps.repo.markDecided(ctx.tenantId, input.requestId, {
    status: "COMPLETED",
    decidedBy: ctx.actorProfileId,
    note: input.note ?? null,
  });

  return ok(closed);
}

/**
 * An admin calls a deletion off, at the student's request.
 *
 * The statuses go back to what the request recorded, not to ACTIVE: a student
 * who was BLOCKED before they asked must stay blocked, or an unpaid student
 * could clear their own block by asking to be deleted and changing their mind.
 */
export async function cancelAccountDeletion(
  ctx: TenantContext,
  input: { readonly requestId: string; readonly note?: string | null },
  deps: AccountDeletionDeps,
): Promise<Result<DeletionRequestRow, DomainError>> {
  const found = await requestOf(ctx, input.requestId, deps);
  if (isErr(found)) return found;

  const decision = cancelDeletion({ actorRole: ctx.role, current: found.value.status });
  if (isErr(decision)) return decision;

  await deps.repo.setAccess(ctx.tenantId, found.value.profileId, {
    profileStatus: found.value.previousProfileStatus,
    studentStatus: found.value.previousStudentStatus,
  });

  const closed = await deps.repo.markDecided(ctx.tenantId, input.requestId, {
    status: "CANCELLED",
    decidedBy: ctx.actorProfileId,
    note: input.note ?? null,
  });

  return ok(closed);
}
