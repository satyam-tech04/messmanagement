/**
 * The session as the mobile client is allowed to see it.
 *
 * `SessionUser` holds identifiers the server derives for itself — `tenantId`,
 * `actorProfileId`, `studentId`. None are serialised here, deliberately. The app
 * never needs them: every endpoint rebuilds its own `TenantContext` from the
 * token, and a `tenantId` in a request body is "an attacker's suggestion, not a
 * fact" (`core/domain/tenant-context.ts`).
 *
 * Leaving them out keeps real tenant UUIDs out of a binary anyone can unpack,
 * and — more importantly — removes the temptation for a later endpoint to start
 * accepting one back, which is precisely the multi-tenancy failure rule 8 exists
 * to prevent.
 *
 * Pure, so `tests/unit/session-payload.test.ts` can assert on what is absent.
 */
import type { UserRole } from "@/core/domain/enums";
import type { SessionUser } from "@/infra/auth/session";

export interface SessionPayload {
  readonly role: UserRole;
  readonly fullName: string;
  /** Gates every screen until the user chooses their own password (D-02). */
  readonly mustChangePassword: boolean;
  /** Human-facing mess identity; not a key the client may send back. */
  readonly tenantSlug: string;
  /**
   * IANA zone of the mess, not the device. Every date the app renders derives
   * from this — a student travelling must still see the mess's service dates.
   */
  readonly timezone: string;
  /** Which shell to route to, without exposing the student's row id. */
  readonly isStudent: boolean;
}

export function toSessionPayload(user: SessionUser): SessionPayload {
  return {
    role: user.role,
    fullName: user.fullName,
    mustChangePassword: user.mustChangePassword,
    tenantSlug: user.tenantSlug,
    timezone: user.timezone,
    isStudent: Boolean(user.studentId),
  };
}
