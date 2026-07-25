/**
 * Signs and verifies QR token payloads.
 *
 * Declared here as an interface so the domain never imports `node:crypto`
 * (§2.2). The Supabase/Node adapter lives in `src/infra/crypto`. This is also
 * what lets the QR policy be unit-tested against a deterministic fake signer
 * with no crypto and no I/O.
 *
 * Implementations MUST compare signatures in constant time. A byte-by-byte
 * early-exit comparison leaks the correct signature to an attacker who can
 * measure response timing across many attempts.
 */
export interface TokenSigner {
  /** Returns the signature for `payload`, base64url-encoded. */
  sign(payload: string, secret: string): string;

  /** Constant-time verification. */
  verify(payload: string, signature: string, secret: string): boolean;
}
