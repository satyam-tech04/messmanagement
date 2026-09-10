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
// ⚠️ NOT renamed with the rest of the product, and must never be.
//
// 82 students' Supabase Auth addresses are derived from this suffix. Changing it
// does not migrate them — it simply stops resolving to the accounts they
// already have, and every one of them is locked out of their meals.
const SYNTHETIC_EMAIL_DOMAIN_SUFFIX = "mess.invalid";

export function isValidRollNumber(rollNumber: string): boolean {
  // Reserved words are refused here rather than at each of the three student
  // creation paths, because this is the one function all of them — and
  // `syntheticEmailFor` — already pass through. A roll number that is legal by
  // shape but collides with the operator login would produce a student whose
  // account exists and can never be signed into, which nobody would discover
  // until they were standing at the counter.
  if (isReservedRollNumber(rollNumber)) return false;
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
 * The platform operator's login (the SUPER_ADMIN who moves between messes).
 *
 * Typed as the bare word `superuser` rather than an address, because the person
 * typing it is the operator, not a customer, and it is easier to remember under
 * pressure. Supabase Auth still needs an email, so the word maps to a fixed
 * synthetic one here — the same trick as student roll numbers, for the same
 * reason.
 *
 * `.internal` is deliberately not `.invalid`: student addresses use `.invalid`
 * and `isSyntheticEmail` keys off it, and the operator is not a student. Both
 * are undeliverable, which is the point — this account is reached by password,
 * never by mail.
 */
export const SUPER_USER_IDENTIFIER = "superuser";
// ⚠️ NOT renamed with the rest of the product, and must never be.
//
// This is the platform operator's actual Auth address, already created. It is
// the one login with no recovery path, so a rename here locks the platform out
// of every tenant with nothing to fall back on.
export const SUPER_USER_EMAIL = "superuser@messos.internal";

/**
 * Roll numbers a student may never hold.
 *
 * `superuser` is a legal roll number by shape, so if a hostel ever issued it,
 * that student would silently capture the operator's login. Rejecting it at
 * student creation costs nothing and closes that off.
 */
export function isReservedRollNumber(rollNumber: string): boolean {
  return rollNumber.trim().toLowerCase() === SUPER_USER_IDENTIFIER;
}

/**
 * Digits a mobile number is keyed on.
 *
 * Ten, not the full number, because the office may hold `+91 98765-43210`,
 * `09876543210` and `9876543210` for the same student and all three must
 * resolve to one person. The `mobile` column in Postgres is generated from this
 * same rule, and `temporaryPasswordFromPhone` derives the initial password from
 * it — so a student's username and their first password come from one
 * normalisation, and it lives here so the three can never disagree.
 */
const MOBILE_DIGITS = 10;

/**
 * Digits, and the punctuation people put between them. Deliberately excludes
 * letters: `+91 98765 43210` and `(0)9876543210` are phone numbers, `CS21B001`
 * is not, and only the first kind should ever be stripped down to digits.
 */
const PHONE_SHAPE = /^[+(]?[\d][\d\s()+-]*$/;

/**
 * The last ten digits of a phone number, or null when there are not ten.
 *
 * Null is the meaningful answer, not an error: a student with no usable number
 * is a student who cannot sign in, and every caller needs to handle that rather
 * than receive a truncated string that resolves to nobody.
 */
export function normalizeMobile(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < MOBILE_DIGITS) return null;
  return digits.slice(-MOBILE_DIGITS);
}

/**
 * What the user typed on the login form.
 *
 * Staff and admins are created with real email addresses; students sign in with
 * their mobile number (D-02, revised). A roll number is no longer a login — it
 * is the counter's manual fallback identifier and, for messes that auto-assign
 * it, a number the student may never see.
 *
 * The three cases are told apart without ambiguity: the operator's reserved
 * word first, then anything containing `@`, then a run of digits long enough to
 * be a mobile number. Anything else is not a login and is refused here rather
 * than sent to the database to fail.
 */
export type LoginIdentifier =
  | { readonly kind: "EMAIL"; readonly email: string }
  | { readonly kind: "MOBILE"; readonly mobile: string };

export function classifyLoginIdentifier(raw: string): LoginIdentifier | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // Checked before anything else: `superuser` is shaped exactly like a valid
  // roll number, so without this branch the platform operator's login would be
  // sent to the student lookup and never resolve.
  if (isReservedRollNumber(trimmed)) {
    return { kind: "EMAIL", email: SUPER_USER_EMAIL };
  }

  if (trimmed.includes("@")) {
    return { kind: "EMAIL", email: trimmed.toLowerCase() };
  }

  // Only things shaped like a phone number reach the mobile branch. Without
  // this, a mistyped roll number of ten-plus characters would be stripped to
  // its digits and looked up as somebody's phone.
  if (!PHONE_SHAPE.test(trimmed)) return null;

  const mobile = normalizeMobile(trimmed);
  if (!mobile) return null;
  return { kind: "MOBILE", mobile };
}
