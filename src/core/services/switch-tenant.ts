/**
 * SwitchTenant — the platform operator moves to another mess.
 *
 * The mechanism is worth stating plainly, because "one login for every tenant"
 * usually means a permission that spans tenants, and that is *not* what happens
 * here. The operator's profile is repointed at the chosen mess and their token
 * re-issued from it. A moment later they are, as far as every RLS policy in the
 * database is concerned, an ordinary admin of that one hostel — and just as
 * blind to the others as its real admin is.
 *
 * That choice is why this feature needed no change to any of the thirty RLS
 * policies protecting a live customer's data. There is no cross-tenant read
 * path to get wrong, because none was created. The blast radius of a bug here
 * is "the operator is looking at the wrong mess", not "a mess admin can see
 * another hostel".
 *
 * Fails closed (rule 7): an unreadable mess list, an unknown target, or a mess
 * that is not ACTIVE all leave the operator exactly where they were.
 */
import type { TenantContext } from "../domain/tenant-context";
import { forbidden, infrastructureError, type DomainError } from "../errors";
import {
  canSwitchTenant,
  parseTenantSwitch,
  type TenantSwitch,
} from "../policies/tenant-switch.policy";
import type { TenantDirectory } from "../ports/repositories";
import { err, isErr, ok, type Result } from "../result";

export interface SwitchTenantDeps {
  readonly directory: TenantDirectory;
}

export async function switchOperatorTenant(
  ctx: TenantContext,
  targetTenantId: string,
  deps: SwitchTenantDeps,
): Promise<Result<TenantSwitch, DomainError>> {
  // Checked before the list is even fetched. A mess admin must not be able to
  // learn the names of the other hostels on the platform by probing this.
  if (!canSwitchTenant(ctx.role)) {
    return err(forbidden("Only a platform admin can move between messes."));
  }

  let available;
  try {
    available = await deps.directory.listSwitchable();
  } catch {
    return err(infrastructureError("the list of messes"));
  }

  const decision = parseTenantSwitch(ctx, targetTenantId, available);
  if (isErr(decision)) return decision;

  // Idempotent (rule 5): switching to the mess already open writes nothing and
  // re-issues nothing. A double-tapped button costs one read.
  if (decision.value.alreadyActive) return ok(decision.value);

  try {
    await deps.directory.moveOperator(ctx.actorProfileId, decision.value.tenant.id);
  } catch {
    return err(infrastructureError("the move to that mess"));
  }

  return ok(decision.value);
}
