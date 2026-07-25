/**
 * Login identity derivation (decision D-02).
 *
 * Students authenticate with **roll number + password**. Supabase Auth requires
 * an email address, so each student gets a deterministic synthetic one derived
 * from their tenant's slug and roll number. The student never sees or types it;
 * it exists purely because the auth provider demands an email-shaped identifier.
 *
 *     CS21B001 @ unversity-mess  ->  cs21b001@unversity-mess.mess.invalid
 *
 * `.invalid` is reserved by RFC 2606 and guaranteed never to resolve, so these
 * addresses can never accidentally receive or send mail. A real, contactable
 * email lives on `profiles.email` instead.
 *
 * Deterministic derivation matters: it means resolving a login needs no lookup
 * table and no extra column, and a student's identity cannot drift out of sync
 * with their roll number.
 *
 * Pure — no I/O, no framework. Lives in core so both the login flow and the
 * admin's student-creation flow derive identity the same way.
 */

/**
 * Characters permitted in a roll number.
 *
 * Restricted to what is safe in an email local-part without quoting. Real roll
 * numbers are alphanumeric with the occasional separator, so this costs nothing
 * in practice and removes an entire class of injection and encoding bugs. The
 * admin UI rejects anything else at entry, so a student is never created with a
 * roll number that cannot produce a login.
 */
const ROLL_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

/** Reserved TLD (RFC 2606). These addresses must never be deliverable. */
const SYNTHETIC_EMAIL_DOMAIN_SUFFIX = "mess.invalid";

export function isValidRollNumber(rollNumber: string): boolean {
  return ROLL_NUMBER_PATTERN.test(rollNumber.trim());
}

/**
 * Normalises a roll number for storage and comparison.
 *
 * Lower-cased to match the `lower(roll_number)` unique index: staff typing
 * `cs21b001` at the counter must find the student stored as `CS21B001`.
 */
export function normalizeRollNumber(rollNumber: string): string {
  return rollNumber.trim().toLowerCase();
}

export class InvalidRollNumberError extends Error {
  constructor(rollNumber: string) {
    super(
      `"${rollNumber}" is not a usable roll number. Use letters, digits, dot, ` +
        `underscore or hyphen, starting with a letter or digit (max 63 characters).`,
    );
    this.name = "InvalidRollNumberError";
  }
}

/**
 * The synthetic Supabase Auth address for a student.
 *
 * Throws rather than returning a fallback: silently mangling an unusable roll
 * number would create an account the student could never log into, and nobody
 * would notice until they were standing at the counter.
 */
export function syntheticEmailFor(tenantSlug: string, rollNumber: string): string {
  if (!isValidRollNumber(rollNumber)) {
    throw new InvalidRollNumberError(rollNumber);
  }
  // The tenant slug is already constrained to `^[a-z0-9][a-z0-9-]+[a-z0-9]$` by
  // a database check, which is exactly the hostname-safe alphabet needed here.
  // That constraint is why the slug is `unversity-mess` and not the project's
  // `unversity_mess` — underscores are invalid in hostnames (D-13).
  return `${normalizeRollNumber(rollNumber)}@${tenantSlug}.${SYNTHETIC_EMAIL_DOMAIN_SUFFIX}`;
}

/** Whether an address was minted by `syntheticEmailFor`. */
export function isSyntheticEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`.${SYNTHETIC_EMAIL_DOMAIN_SUFFIX}`);
}

/**
 * What the user typed on the login form.
 *
 * Staff and admins are created with real email addresses; students log in with
 * a roll number. Distinguishing on `@` is unambiguous because a roll number can
 * never contain one.
 */
export type LoginIdentifier =
  | { readonly kind: "EMAIL"; readonly email: string }
  | { readonly kind: "ROLL_NUMBER"; readonly rollNumber: string };

export function classifyLoginIdentifier(raw: string): LoginIdentifier | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  if (trimmed.includes("@")) {
    return { kind: "EMAIL", email: trimmed.toLowerCase() };
  }
  if (!isValidRollNumber(trimmed)) return null;
  return { kind: "ROLL_NUMBER", rollNumber: normalizeRollNumber(trimmed) };
}
