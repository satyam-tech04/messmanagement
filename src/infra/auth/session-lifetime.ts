/**
 * How long a signed-in session survives.
 *
 * Two separate things decide this, and only one of them is ours:
 *
 *   1. **The access token** lives one hour and is refreshed automatically by
 *      `proxy.ts` on every request. Nobody ever notices this; it is not what
 *      signs people out.
 *   2. **The cookie** carrying the refresh token. Supabase's defaults make it a
 *      *session* cookie in some flows, so closing the browser — or a counter
 *      tablet rebooting overnight — throws the session away and staff arrive to
 *      a login screen at 07:00 with a queue forming.
 *
 * The mess wants (2) to effectively never happen. A counter device is shared,
 * physical, and used by people who should not be typing passwords mid-service.
 *
 * The trade being made, stated plainly: a lost or stolen phone stays signed in
 * until someone resets that account's password. That is why `resetStudentPassword`
 * exists, and why it is the documented remedy for a lost device.
 */

/** One year. Long enough that no ordinary gap in usage ends a session. */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Forces an auth cookie to be persistent.
 *
 * Only touches lifetime — `httpOnly`, `secure`, `sameSite` and `path` are left
 * exactly as the Supabase library set them, because those are the properties
 * that keep the token away from scripts and off other origins.
 *
 * A cookie the library is deliberately clearing (empty value, or `maxAge` of
 * zero) is passed through untouched. Extending those would resurrect a token
 * during sign-out.
 */
export function persistentCookieOptions<T extends Record<string, unknown>>(
  value: string,
  options: T | undefined,
): T & { maxAge?: number } {
  const existing = options ?? ({} as T);

  const isClearing =
    value === "" ||
    (typeof existing.maxAge === "number" && existing.maxAge <= 0) ||
    (existing.expires instanceof Date && existing.expires.getTime() <= Date.now());

  if (isClearing) return existing;

  return {
    ...existing,
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    // `expires` would otherwise win over maxAge in some browsers and cut the
    // session short, so drop it and let maxAge be the single source of truth.
    expires: undefined,
  };
}
