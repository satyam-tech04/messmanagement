/**
 * Reading an access token out of an `Authorization` header.
 *
 * Pure and dependency-free so it can be tested directly and used from either
 * transport. The strictness is deliberate: a token is the mobile client's whole
 * identity, and a parser that returned `""` or a fragment would push a
 * meaningless value into `getClaims()`, where the resulting failure looks
 * exactly like a forged token. Refuse it here, where the reason is legible.
 */

/** `Bearer <token>`, scheme case-insensitive per RFC 7235. */
const BEARER = /^Bearer[ \t]+(\S+)[ \t]*$/i;

/**
 * The token, or null if the header is missing or not a well-formed bearer
 * credential. A JWT never contains whitespace, so `\S+` is the whole grammar
 * that matters here.
 */
export function parseBearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = BEARER.exec(header);
  return match?.[1] ?? null;
}
