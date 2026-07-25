/**
 * Typed domain errors.
 *
 * Every failure a use case can return is enumerated here with a stable `code`.
 * The codes are part of the contract with the UI: the scanner shows a different
 * colour and sound for each one (§6.4), because a generic red X forces staff to
 * debug at the counter with a queue behind them.
 *
 * Messages here are operator-facing English. Student-facing copy is chosen at
 * the render boundary from the code, so it can be translated without touching
 * the domain (§12, i18n).
 */

export type DomainErrorCode =
  // --- Authorization / tenancy ---
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "TENANT_MISMATCH"
  | "TENANT_SUSPENDED"
  // --- QR attendance (§6.4) ---
  | "INVALID_TOKEN"
  | "EXPIRED_TOKEN"
  | "ALREADY_SERVED"
  | "NO_ACTIVE_PLAN"
  | "BLOCKED_UNPAID"
  | "ON_MESS_CUT"
  | "OUTSIDE_MEAL_HOURS"
  | "SLOT_NOT_SERVED"
  | "STUDENT_INACTIVE"
  // --- Generic ---
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "CONFLICT"
  | "ILLEGAL_TRANSITION"
  | "INFRASTRUCTURE_ERROR";

export interface DomainError {
  readonly code: DomainErrorCode;
  readonly message: string;
  /** Structured context for logs and for rendering. Never contains PII. */
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}

export function domainError(
  code: DomainErrorCode,
  message: string,
  details?: DomainError["details"],
): DomainError {
  return details ? { code, message, details } : { code, message };
}

// --- Constructors for the errors raised often enough to deserve a name ---

export const unauthenticated = (): DomainError =>
  domainError("UNAUTHENTICATED", "No authenticated session.");

export const forbidden = (reason: string): DomainError => domainError("FORBIDDEN", reason);

export const notFound = (entity: string): DomainError =>
  domainError("NOT_FOUND", `${entity} not found.`);

export const conflict = (reason: string): DomainError => domainError("CONFLICT", reason);

export const illegalTransition = (entity: string, from: string, to: string): DomainError =>
  domainError("ILLEGAL_TRANSITION", `${entity} cannot move from ${from} to ${to}.`, {
    from,
    to,
  });

/**
 * Wraps an unexpected infrastructure fault (database unreachable, timeout).
 *
 * Callers on the security and money paths must treat this as a **denial**, not
 * a pass (§2.7). The manual fallback exists precisely so that failing closed
 * costs 20 seconds instead of the product's credibility.
 */
export const infrastructureError = (operation: string): DomainError =>
  domainError("INFRASTRUCTURE_ERROR", `Could not complete ${operation}.`, { operation });

/**
 * Whether an error means "the request was understood and refused" as opposed to
 * "something broke". Drives the HTTP status at the boundary and, more
 * importantly, whether the scanner should offer a retry.
 */
export function isDenial(error: DomainError): boolean {
  return error.code !== "INFRASTRUCTURE_ERROR";
}
