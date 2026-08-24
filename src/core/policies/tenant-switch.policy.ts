/**
 * Moving the platform operator between messes.
 *
 * Every other rule in this system says a caller stays inside one tenant. This
 * is the single sanctioned exception, and it exists because one person runs the
 * platform and must be able to support any customer without holding six
 * passwords.
 *
 * How the crossing actually works matters for reading this file: the operator
 * is not given a key to all tenants at once. Their profile is *moved* to the
 * chosen mess and their token re-issued, so at any instant they are an admin of
 * exactly one hostel and RLS is doing the same job for them that it does for
 * everyone else. Nothing here widens a policy; there is no "see all tenants"
 * mode to leak. That is why this is safe to ship against a live customer.
 *
 * Pure — no I/O. The Server Action and any future CLI both call this, so the
 * rules cannot drift between the two front doors.
 */
import type { TenantStatus, UserRole } from "../domain/enums";
import type { TenantContext } from "../domain/tenant-context";
import { domainError, forbidden, notFound, type DomainError } from "../errors";
import { err, ok, type Result } from "../result";

/** A mess the operator may move into, as offered by the switcher. */
export interface SwitchableTenant {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly status: TenantStatus;
}

/**
 * Exact role match, never `hasAtLeastRole`. A mess admin reaching another
 * hostel's students is the worst failure this product has, so the check that
 * prevents it does not want a ranking function between it and the truth.
 */
export function canSwitchTenant(role: UserRole): boolean {
  return role === "SUPER_ADMIN";
}

export interface TenantSwitch {
  readonly tenant: SwitchableTenant;
  /** The operator is already in this mess; the caller should do nothing. */
  readonly alreadyActive: boolean;
}

export function parseTenantSwitch(
  ctx: TenantContext,
  targetTenantId: string,
  available: readonly SwitchableTenant[],
): Result<TenantSwitch, DomainError> {
  if (!canSwitchTenant(ctx.role)) {
    return err(forbidden("Only a platform admin can move between messes."));
  }

  const id = targetTenantId.trim();
  if (id.length === 0) {
    return err(domainError("VALIDATION_FAILED", "Choose a mess to switch to."));
  }

  // Resolved against the offered list rather than trusted. The id arrives from
  // a form, and a form value is a suggestion (rule 8) — an operator whose
  // browser posts an id that is not on the list gets nothing.
  const tenant = available.find((t) => t.id === id);
  if (!tenant) return err(notFound("That mess"));

  // Fail closed (rule 7). A suspended or cancelled mess is one whose data
  // nobody should be working in, and the session layer already refuses to hold
  // a session for it — landing there would strand the operator with no way back.
  if (tenant.status !== "ACTIVE") {
    return err(
      domainError(
        "TENANT_SUSPENDED",
        `${tenant.name} is ${tenant.status.toLowerCase()}. Reactivate it before working in it.`,
      ),
    );
  }

  return ok({ tenant, alreadyActive: tenant.id === ctx.tenantId });
}
