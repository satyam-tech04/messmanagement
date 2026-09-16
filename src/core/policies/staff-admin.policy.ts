/**
 * Staff administration policy.
 *
 * An admin hires somebody and needs them behind the counter the same evening.
 * Until this existed, staff logins came only from a provisioning script, so the
 * mess had to ask us — which is not a thing a customer should ever have to do.
 *
 * Pure — no I/O, no framework. The Server Action calls this and maps the result.
 */
import { isSyntheticEmail } from "@/core/domain/identity";
import type { UserRole } from "@/core/domain/enums";
import { domainError, forbidden, type DomainError } from "@/core/errors";
import { err, ok, type Result } from "@/core/result";

/** Deliberately the same shape the provisioning policy accepts for an owner. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Matches the student details form, so one person's number is valid in both. */
const PHONE = /^\+?[0-9]{7,15}$/;

export interface StaffInviteRequest {
  readonly actorRole: UserRole;
  readonly fullName: string;
  readonly email: string;
  readonly phone?: string;
}

export interface StaffInvite {
  readonly fullName: string;
  readonly email: string;
  readonly phone: string | null;
}

export function parseStaffInvite(request: StaffInviteRequest): Result<StaffInvite, DomainError> {
  // Checked first, so someone who may not create staff learns nothing about the
  // rest of the rules from the error they get back.
  if (request.actorRole !== "ADMIN" && request.actorRole !== "SUPER_ADMIN") {
    return err(forbidden("Only an admin can create a staff login."));
  }

  const fullName = request.fullName.trim();
  if (fullName.length < 2) {
    return err(domainError("VALIDATION_FAILED", "Enter the staff member's full name."));
  }
  if (fullName.length > 120) {
    return err(domainError("VALIDATION_FAILED", "That name is too long."));
  }

  // Lower-cased rather than refused: an admin typing "Roshni@..." should not be
  // told off, but the same person must not become two different logins.
  const email = request.email.trim().toLowerCase();
  if (!EMAIL.test(email)) {
    return err(domainError("VALIDATION_FAILED", `"${request.email.trim()}" is not a valid email.`));
  }
  // Students' addresses are derived from roll numbers and are unreachable by
  // design (RFC 2606 `.invalid`). A staff account on one could never be
  // recovered, and would sit inside the students' own namespace.
  if (isSyntheticEmail(email)) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        "Staff sign in with a real email address they can receive mail at, not a student login address.",
      ),
    );
  }

  const phone = request.phone?.trim() ?? "";
  if (phone.length > 0 && !PHONE.test(phone)) {
    return err(domainError("VALIDATION_FAILED", "Enter a valid phone number."));
  }

  return ok({ fullName, email, phone: phone.length > 0 ? phone : null });
}
