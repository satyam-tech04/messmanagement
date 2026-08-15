/**
 * Creating a new mess.
 *
 * This runs against production, by hand, to onboard a paying customer, and it
 * effectively gets one attempt. The slug in particular is not a cosmetic
 * choice: every student's login email is derived from it
 * (`cs21b001@sunrise-mess.mess.invalid`), so changing it later would break
 * every account in the hostel at once.
 *
 * Validated here rather than left to Postgres so the operator gets a sentence
 * telling them what to type, instead of a constraint violation halfway through
 * provisioning with a tenant row already written.
 *
 * Pure — the script and, later, a SUPER_ADMIN screen both call this, so the
 * rules cannot differ between the two front doors.
 */
import { domainError, type DomainError } from "../errors";
import { err, ok, type Result } from "../result";

/**
 * Mirrors `tenants_slug_format`. Kept beside the constraint name deliberately:
 * if a migration ever widens it, the two must move together.
 */
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Reserved by RFC 2606 and used for generated student logins, which can never
 * receive mail. An admin who cannot be emailed cannot recover their account.
 */
const SYNTHETIC_SUFFIX = ".invalid";

/**
 * Hard-coded for now. Every pilot mess is in India, and a wrong timezone is the
 * most expensive setting in the system — it moves every service date, every
 * meal window and the daily headcount boundary, and cannot be changed later
 * without rewriting history. When a mess outside IST arrives this becomes an
 * argument; until then, one less thing to type wrong.
 */
export const DEFAULT_TIMEZONE = "Asia/Kolkata";

export interface MessProvisionInput {
  readonly name: string;
  readonly slug: string;
  readonly adminEmail: string;
}

export interface MessProvision {
  readonly name: string;
  readonly slug: string;
  readonly adminEmail: string;
  readonly timezone: string;
}

export function parseMessProvision(input: MessProvisionInput): Result<MessProvision, DomainError> {
  const name = input.name.trim();
  if (name.length === 0) {
    return err(domainError("VALIDATION_FAILED", "The mess needs a name — students will see it."));
  }
  if (name.length > 120) {
    return err(domainError("VALIDATION_FAILED", "That name is too long."));
  }

  // Lower-cased rather than rejected: an operator typing a proper noun should
  // not be told off for it. The display name keeps whatever they typed.
  const slug = input.slug.trim().toLowerCase();
  if (!SLUG.test(slug)) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `"${input.slug}" cannot be used as the identifier. Use 3–40 letters, digits and hyphens, starting and ending with a letter or digit — for example "sunrise-mess". Every student's login is derived from this, so it cannot be changed afterwards.`,
      ),
    );
  }

  const adminEmail = input.adminEmail.trim().toLowerCase();
  if (!EMAIL.test(adminEmail)) {
    return err(domainError("VALIDATION_FAILED", `"${input.adminEmail}" is not a valid email.`));
  }
  if (adminEmail.endsWith(SYNTHETIC_SUFFIX)) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        "That is a generated student address and can never receive mail. Use the owner's real email — they will need it to recover the account.",
      ),
    );
  }

  return ok({ name, slug, adminEmail, timezone: DEFAULT_TIMEZONE });
}
