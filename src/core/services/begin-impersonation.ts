/**
 * BeginStudentImpersonation — the platform operator enters a student's account.
 *
 * This decides *whether*; the session swap itself is the transport layer's job,
 * the same split the mess switcher uses for its token refresh. What the operator
 * gets is exactly that student's session, so every student screen, RLS policy
 * and QR rule applies to them unchanged — nothing here widens anyone's access.
 *
 * The student is looked up in the operator's **current** mess only. Entering a
 * student in another hostel means switching to it first, which is audited
 * there.
 */
import type { TenantContext } from "../domain/tenant-context";
import { forbidden, infrastructureError, type DomainError } from "../errors";
import {
  parseImpersonationTarget,
  type ImpersonationCandidate,
} from "../policies/operator-access.policy";
import type { ImpersonationDirectory } from "../ports/repositories";
import { err, type Result } from "../result";

export interface BeginImpersonationDeps {
  readonly directory: ImpersonationDirectory;
}

export async function beginStudentImpersonation(
  ctx: TenantContext,
  targetProfileId: string,
  deps: BeginImpersonationDeps,
): Promise<Result<ImpersonationCandidate, DomainError>> {
  // Before the lookup, so a mess admin cannot probe which ids are accounts.
  if (ctx.role !== "SUPER_ADMIN") {
    return err(forbidden("Only a platform admin can enter a student's account."));
  }

  let candidate: ImpersonationCandidate | null;
  try {
    candidate = await deps.directory.findStudentAccount(ctx.tenantId, targetProfileId.trim());
  } catch {
    return err(infrastructureError("the student lookup"));
  }

  return parseImpersonationTarget(ctx, targetProfileId, candidate);
}
