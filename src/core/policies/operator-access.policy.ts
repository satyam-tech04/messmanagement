/**
 * Who may use the website, and how the platform operator works as each role.
 *
 * Two rules live here because they meet at the same door, the web sign-in:
 *
 * 1. **The website is for running a mess, the app is for eating in one.**
 *    Students and counter staff belong on the MealAdda app. While the app is
 *    still reaching a mess's phones that rule is held behind a deploy-level
 *    switch, so turning it on is a decision rather than a side effect of a
 *    release — flipping it early would leave a live hostel with no QR codes.
 *
 * 2. **The operator can see the product as any role.** Admin and staff need
 *    nothing new: the operator already passes both gates. Student is
 *    different — a student screen is one specific student's day, so "as a
 *    student" means entering a real student's account. That is impersonation,
 *    and it is confined exactly like the mess switcher: one mess (the one the
 *    operator is already in), students only, active accounts only.
 *
 * The impersonation marker is a signed cookie that says "this student session
 * is really the operator". It earns its signature: it exempts the session from
 * the forced password change (the operator must never set a student's
 * password) and shows the exit banner. A student able to forge one would skip
 * that change, so it is verified, bound to the session's own profile, and
 * short-lived.
 *
 * Pure — no I/O, no `node:crypto`. The signer is a port.
 */
import type { ProfileStatus, UserRole } from "../domain/enums";
import type { TenantContext } from "../domain/tenant-context";
import { domainError, forbidden, notFound, type DomainError } from "../errors";
import type { TokenSigner } from "../ports/token-signer";
import { err, ok, type Result } from "../result";

// ---------------------------------------------------------------------------
// Web sign-in
// ---------------------------------------------------------------------------

export interface WebSignInOptions {
  /** Deploy-level switch: when on, only admins and the operator use the website. */
  readonly appOnly: boolean;
}

export function canSignInOnWeb(role: UserRole, { appOnly }: WebSignInOptions): boolean {
  if (!appOnly) return true;
  // Exact roles, not a ranking — the same reasoning as the mess switcher.
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

// ---------------------------------------------------------------------------
// Operator personas
// ---------------------------------------------------------------------------

export type OperatorPersona = "ADMIN" | "STAFF" | "STUDENT";

export interface OperatorPersonaOption {
  readonly persona: OperatorPersona;
  readonly href: string;
}

/**
 * What the operator is offered after signing in. Student goes to a picker
 * rather than `/student`: the operator has no student record, and that shell
 * would render an empty account instead of anybody's real day.
 */
export const OPERATOR_PERSONAS: readonly OperatorPersonaOption[] = [
  { persona: "ADMIN", href: "/admin" },
  { persona: "STAFF", href: "/staff" },
  { persona: "STUDENT", href: "/superuser/students" },
];

// ---------------------------------------------------------------------------
// Impersonation target
// ---------------------------------------------------------------------------

/** An account as read for the operator's "enter as" decision. */
export interface ImpersonationCandidate {
  readonly profileId: string;
  readonly tenantId: string;
  readonly role: UserRole;
  readonly profileStatus: ProfileStatus;
  readonly fullName: string;
  readonly rollNumber: string | null;
}

export function parseImpersonationTarget(
  ctx: TenantContext,
  targetProfileId: string,
  candidate: ImpersonationCandidate | null,
): Result<ImpersonationCandidate, DomainError> {
  if (ctx.role !== "SUPER_ADMIN") {
    return err(forbidden("Only a platform admin can enter a student's account."));
  }

  const id = targetProfileId.trim();
  if (id.length === 0) {
    return err(domainError("VALIDATION_FAILED", "Choose a student to enter as."));
  }

  // NOT_FOUND for another mess as well as for nobody at all. The operator is in
  // one mess at a time, and an answer that distinguished the two would confirm
  // that an id belongs to a student somewhere else on the platform.
  if (!candidate || candidate.profileId !== id || candidate.tenantId !== ctx.tenantId) {
    return err(notFound("That student"));
  }

  // Students only. Entering an admin's account would be a way around the
  // audit trail the mess switcher writes, and staff are already reachable as
  // the operator themselves.
  if (candidate.role !== "STUDENT") {
    return err(forbidden("Only a student's account can be entered."));
  }

  // The session layer refuses a disabled profile, so entering one would sign
  // the operator out of their own account and into nothing.
  if (candidate.profileStatus !== "ACTIVE") {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `${candidate.fullName}'s account is disabled. Re-enable it before entering it.`,
      ),
    );
  }

  return ok(candidate);
}

// ---------------------------------------------------------------------------
// Impersonation marker
// ---------------------------------------------------------------------------

/**
 * Two hours: long enough to reproduce what a student reported, short enough
 * that a forgotten tab on a shared laptop stops being the operator soon.
 */
export const IMPERSONATION_TTL_SECONDS = 2 * 60 * 60;

export interface ImpersonationMarker {
  readonly operatorProfileId: string;
  readonly studentProfileId: string;
  readonly tenantId: string;
  /** ISO timestamp. */
  readonly expiresAt: string;
}

/** Cookie-safe base64 of an ASCII string (UUIDs and ISO dates only). */
function toBase64Url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    return atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  } catch {
    return null;
  }
}

export function encodeImpersonationMarker(
  marker: ImpersonationMarker,
  signer: TokenSigner,
  secret: string,
): string {
  const payload = toBase64Url(
    JSON.stringify({
      operatorProfileId: marker.operatorProfileId,
      studentProfileId: marker.studentProfileId,
      tenantId: marker.tenantId,
      expiresAt: marker.expiresAt,
    }),
  );
  return `${payload}.${signer.sign(payload, secret)}`;
}

export interface ReadMarkerOptions {
  readonly signer: TokenSigner;
  readonly secret: string;
  readonly now: Date;
  /** The profile the verified session belongs to. */
  readonly sessionProfileId: string;
}

/** The marker, or null for anything short of a valid one (rule 7). */
export function readImpersonationMarker(
  raw: string | undefined,
  { signer, secret, now, sessionProfileId }: ReadMarkerOptions,
): ImpersonationMarker | null {
  if (!raw) return null;

  const dot = raw.indexOf(".");
  if (dot <= 0 || dot === raw.length - 1) return null;
  const payload = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);

  if (!signer.verify(payload, signature, secret)) return null;

  const json = fromBase64Url(payload);
  if (json === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

  const { operatorProfileId, studentProfileId, tenantId, expiresAt } = parsed as Record<
    string,
    unknown
  >;
  if (
    typeof operatorProfileId !== "string" ||
    typeof studentProfileId !== "string" ||
    typeof tenantId !== "string" ||
    typeof expiresAt !== "string"
  ) {
    return null;
  }

  const expiry = Date.parse(expiresAt);
  if (Number.isNaN(expiry) || expiry <= now.getTime()) return null;

  // Bound to the session it was issued for. A cookie that outlived a sign-out
  // on a shared machine must not follow the next person who signs in there.
  if (studentProfileId !== sessionProfileId) return null;

  return { operatorProfileId, studentProfileId, tenantId, expiresAt };
}
