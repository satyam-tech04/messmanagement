/**
 * HMAC-SHA256 implementation of the `TokenSigner` port (architecture doc §6.2).
 *
 * This is the adapter behind the QR policy's signature check. It lives in
 * `src/infra` precisely so that `src/core` never imports `node:crypto` and the
 * whole token policy stays unit-testable with a fake signer.
 *
 * The security-critical detail is `timingSafeEqual`. A plain `===` on strings
 * short-circuits at the first differing byte, so the time it takes to reject a
 * signature leaks how many leading bytes were correct. Given the scanner
 * endpoint accepts repeated attempts, that is enough to reconstruct a valid
 * signature byte by byte without ever knowing the secret. The cost of doing it
 * right is one buffer comparison.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { TokenSigner } from "@/core/ports/token-signer";

function computeSignature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("base64url");
}

export const hmacTokenSigner: TokenSigner = {
  sign(payload: string, secret: string): string {
    return computeSignature(payload, secret);
  },

  verify(payload: string, signature: string, secret: string): boolean {
    const expected = computeSignature(payload, secret);

    const expectedBytes = Buffer.from(expected, "utf8");
    const providedBytes = Buffer.from(signature, "utf8");

    // timingSafeEqual throws on a length mismatch, which would itself leak
    // length through the exception path. Compare lengths first and return the
    // same `false` either way — a wrong-length signature is worthless anyway,
    // and an attacker learning only "wrong length" gains nothing, since the
    // length of an HMAC-SHA256 digest is fixed and public.
    if (expectedBytes.length !== providedBytes.length) return false;

    return timingSafeEqual(expectedBytes, providedBytes);
  },
};
