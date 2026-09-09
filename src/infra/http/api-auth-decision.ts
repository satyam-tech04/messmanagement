/**
 * Who may proceed on a JSON endpoint, decided from an already-resolved session.
 *
 * Pure and free of `server-only` so it can be tested directly — the same split
 * as `session-lifetime.ts` beside `session.ts`. The I/O that fetches the user
 * lives in `api-auth.ts`; only the rule lives here.
 *
 * The rule that matters is the forced password change. `must_change_password`
 * moves a user off the temporary password an admin issued them — one derived
 * from their own phone number, and therefore known to whoever created the
 * account. On the web that gate is `src/app/(app)/layout.tsx`, which `/api/*`
 * sits outside of, so without this check the app would be a permanent way
 * around it.
 */
import type { SessionUser } from "@/infra/auth/session";

/** Why a request was refused, before it becomes any particular error envelope. */
export type ApiAuthFailure = {
  readonly ok: false;
  readonly code: "UNAUTHENTICATED" | "PASSWORD_CHANGE_REQUIRED";
  readonly status: 401 | 403;
  readonly message: string;
};

export type ApiAuth = { readonly ok: true; readonly user: SessionUser } | ApiAuthFailure;

export interface ApiAuthOptions {
  /**
   * Let a user through who still owes a password change.
   *
   * Only the change-password endpoint may set this. Everything else must
   * refuse, or the flag means nothing.
   */
  readonly allowPasswordChangePending?: boolean;
}

export function apiAuthDecision(user: SessionUser | null, options: ApiAuthOptions = {}): ApiAuth {
  // Fail closed (§2.7): an indeterminate session is no session.
  if (!user) {
    return { ok: false, code: "UNAUTHENTICATED", status: 401, message: "Sign in again." };
  }

  if (user.mustChangePassword && !options.allowPasswordChangePending) {
    return {
      ok: false,
      code: "PASSWORD_CHANGE_REQUIRED",
      status: 403,
      message: "Choose your own password before continuing.",
    };
  }

  return { ok: true, user };
}
