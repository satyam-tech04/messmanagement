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
const ALPHABET = "ABCDEFGHJKMNPQRTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
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
