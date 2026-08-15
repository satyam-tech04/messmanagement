import type { UserRole } from "./enums";
import type { MealSlot } from "./enums";
import type { WallClockTime } from "../time";
import { forbidden, type DomainError } from "../errors";
import { err, ok, type Result } from "../result";

/**
 * The authenticated caller, resolved **server-side from the session** (§5.1).
 *
 * Every use case takes one of these as its first argument. It is never
 * constructed from a client-supplied parameter — a `tenantId` in a request body
 * is an attacker's suggestion, not a fact. Application-layer authorization
 * lives here because RLS protects rows but cannot express "staff may verify
 * attendance but not issue refunds."
 */
export interface TenantContext {
  readonly tenantId: string;
  readonly tenantSlug: string;
  /** IANA zone. Every service_date derivation for this tenant uses it (§2.9). */
  readonly timezone: string;
  readonly actorProfileId: string;
  readonly role: UserRole;
  /** Present only when the actor is a student. */
  readonly studentId?: string;
}

/** A configured meal service window, parsed from `tenant_settings.meal_slots`. */
export interface MealSlotConfig {
  readonly slot: MealSlot;
  readonly start: WallClockTime;
  readonly end: WallClockTime;
}

/**
 * The tenant's policy values (§1.1). Every one of these is a stored setting,
 * never a constant in code — "the moment a rule is hardcoded, the second
 * customer becomes a fork."
 */
export interface TenantSettings {
  readonly tenantId: string;
  readonly mealSlots: readonly MealSlotConfig[];
  readonly cutAdvanceHours: number;
  readonly cutMaxDaysPerMonth: number;
  /** Absences (migration 008). All default off — see absence.policy.ts. */
  readonly allowMealSkipping: boolean;
  readonly allowPartialDaySkip: boolean;
  readonly allowAwayRequests: boolean;
  readonly awayRequiresApproval: boolean;
  readonly awayAdvanceHours: number;
  readonly awayMaxDays: number;
  readonly gracePeriodDays: number;
  readonly blockOnOverdue: boolean;
  readonly allowExtras: boolean;
  readonly guestTokenPricePaise: number;
  readonly extraPlatePricePaise: number;
  readonly qrTokenTtlSeconds: number;
  readonly qrRefreshSeconds: number;
  readonly currency: string;
}

/** Looks up a slot's configured window; undefined if the tenant does not serve it. */
export function findMealSlotConfig(
  settings: TenantSettings,
  slot: MealSlot,
): MealSlotConfig | undefined {
  return settings.mealSlots.find((s) => s.slot === slot);
}

// ---------------------------------------------------------------------------
// Role authorization
// ---------------------------------------------------------------------------

const ROLE_RANK: Readonly<Record<UserRole, number>> = {
  STUDENT: 0,
  STAFF: 1,
  ADMIN: 2,
  SUPER_ADMIN: 3,
};

export function hasRole(ctx: TenantContext, ...allowed: readonly UserRole[]): boolean {
  return allowed.includes(ctx.role);
}

/** True when the actor's role is at least as privileged as `minimum`. */
export function hasAtLeastRole(ctx: TenantContext, minimum: UserRole): boolean {
  return ROLE_RANK[ctx.role] >= ROLE_RANK[minimum];
}

/**
 * Guards a use case. Returns a `Result` rather than throwing so that
 * authorization failures flow through the same handling path as every other
 * domain outcome.
 */
export function requireRole(
  ctx: TenantContext,
  ...allowed: readonly UserRole[]
): Result<TenantContext, DomainError> {
  if (!hasRole(ctx, ...allowed)) {
    return err(
      forbidden(`This action requires one of: ${allowed.join(", ")}. Actor is ${ctx.role}.`),
    );
  }
  return ok(ctx);
}

/**
 * Guards that a resource belongs to the caller's tenant.
 *
 * This duplicates what RLS already enforces, deliberately (§5.1 — two
 * independent layers). Application code that forgets a `tenant_id` filter is
 * the likeliest failure, and it should fail here with a clear error rather than
 * relying on the database as the only line of defence.
 */
export function requireSameTenant(
  ctx: TenantContext,
  resourceTenantId: string,
): Result<void, DomainError> {
  if (resourceTenantId !== ctx.tenantId) {
    return err({
      code: "TENANT_MISMATCH",
      message: "Resource belongs to a different tenant.",
    });
  }
  return ok(undefined);
}
