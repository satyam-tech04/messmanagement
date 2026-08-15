import { randomInt } from "node:crypto";

/**
 * Generates a temporary password for an admin-issued account (D-02).
 *
 * Two deliberate choices:
 *
 * 1. **`randomInt` from `node:crypto`, not `Math.random`.** These passwords
 *    protect real accounts, and `Math.random` is seeded predictably enough to
 *    be guessable across a batch of students created in one sitting.
 *
 * 2. **An unambiguous alphabet.** `0/O`, `1/l/I` and `5/S` are removed. The
 *    admin reads this aloud or writes it on a slip of paper for a student, and
 *    every ambiguous character is a support call.
 *
 * The result is ~62 bits of entropy over 12 characters, which is far beyond
 * what matters given it is single-use and must be changed at first login.
 */
// `5` was still here despite the note above saying it had been removed — the
// one ambiguous character the original alphabet missed. It is read aloud to a
// student as often as any other, and "5" against "S" is exactly the pair that
// costs a support call.
const ALPHABET = "ABCDEFGHJKMNPQRTUVWXYZabcdefghijkmnpqrstuvwxyz2346789";
const LENGTH = 12;

export function generateTemporaryPassword(): string {
  let out = "";
  for (let i = 0; i < LENGTH; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  // Grouped for reading aloud: "Kx7m-Rp2q-Wn4t" is far easier to dictate
  // accurately than an unbroken run of twelve characters.
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

/**
 * A student's initial password, derived from their own mobile number.
 *
 * Used by every path that registers a student — the single form, the bulk grid
 * and the CSV import — so the rule an admin announces is the same one however
 * that student got into the system. There is no version of this where some
 * students' passwords work differently from others'.
 *
 * The reason is distribution. Several hundred students cannot each be handed a
 * random password, because there is no channel to hand it over; a number they
 * already know needs no distribution at all, and one broadcast message onboards
 * the whole hostel.
 *
 * The trade is that this password is guessable by anyone who knows the student's
 * number. What bounds it is `must_change_password`, which forces a new password
 * before any screen loads, so the guessable one exists only between registration
 * and that student's first meal. Do not relax that without revisiting this.
 *
 * **The last ten digits**, so every way the office might have typed one number
 * yields the one password the student will actually type: `+91 98765-43210`,
 * `09876543210` and `9876543210` are the same person and the same password.
 *
 * Returns null when no usable password can be derived — a short or missing
 * number — and the caller falls back to a generated one. Silently truncating
 * would tell the student something that does not work, and anything under six
 * characters is rejected by the auth provider mid-import.
 */
const MOBILE_DIGITS = 10;

export function temporaryPasswordFromPhone(phone: string | undefined | null): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < MOBILE_DIGITS) return null;
  return digits.slice(-MOBILE_DIGITS);
}
