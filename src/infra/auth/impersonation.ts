/**
 * The cookies behind "enter as this student", and the session swap itself.
 *
 * Two cookies, both httpOnly:
 *
 * - **the marker** — signed, says "this student session is really the
 *   operator". The app layout reads it to skip the forced password change and
 *   to show the exit banner. Verified by `readImpersonationMarker`, bound to
 *   the session's profile, and gone in two hours.
 * - **the operator's own session** — the access and refresh token the operator
 *   held before entering, so Exit returns them without a password. It is the
 *   same secret the ordinary auth cookie already carries, kept for the same
 *   length of time as the marker and never readable by page scripts.
 *
 * The student account is entered through a one-time sign-in link generated
 * with the service role and verified on the server. No email is sent — the
 * link is consumed here — and the student's own sessions on their phone are
 * untouched: this adds a session, and Exit revokes only that one.
 */
import "server-only";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  IMPERSONATION_TTL_SECONDS,
  encodeImpersonationMarker,
  readImpersonationMarker,
  type ImpersonationMarker,
} from "@/core/policies/operator-access.policy";
import { hmacTokenSigner } from "@/infra/crypto/hmac-signer";
import { serverEnv, isProduction } from "@/lib/env.server";
import type { Database } from "../supabase/database.types";

const MARKER_COOKIE = "ma_impersonation";
const OPERATOR_COOKIE = "ma_operator_session";

/**
 * Domain-separated from QR signing. Reusing the configured secret avoids a new
 * env var on a live deployment; prefixing it means a valid QR signature can
 * never double as a valid marker, or the reverse.
 */
function markerSecret(): string {
  return `mealadda.impersonation.v1:${serverEnv.QR_SIGNING_SECRET}`;
}

const cookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: "lax" as const,
  path: "/",
  maxAge: IMPERSONATION_TTL_SECONDS,
};

/** The verified marker for this session, or null. */
export async function readImpersonation(
  sessionProfileId: string,
): Promise<ImpersonationMarker | null> {
  const store = await cookies();
  return readImpersonationMarker(store.get(MARKER_COOKIE)?.value, {
    signer: hmacTokenSigner,
    secret: markerSecret(),
    now: new Date(),
    sessionProfileId,
  });
}

export interface OperatorTokens {
  readonly access_token: string;
  readonly refresh_token: string;
}

export type SwapResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "NO_OPERATOR_SESSION" | "LINK_FAILED" | "VERIFY_FAILED";
    };

/**
 * Replaces the operator's session with the student's, remembering the way back.
 *
 * Only for a target already approved by `beginStudentImpersonation`. Must run
 * in a Server Action or route handler — cookies are written.
 */
export async function swapIntoStudentSession(
  supabase: SupabaseClient<Database>,
  admin: SupabaseClient<Database>,
  params: {
    readonly operatorProfileId: string;
    readonly studentProfileId: string;
    readonly studentEmail: string;
    readonly tenantId: string;
  },
): Promise<SwapResult> {
  // The operator's current tokens, read from their own (already verified)
  // session cookie. Kept only so Exit can put them back.
  const { data: current } = await supabase.auth.getSession();
  const operator = current.session;
  if (!operator) return { ok: false, reason: "NO_OPERATOR_SESSION" };

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: params.studentEmail,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) return { ok: false, reason: "LINK_FAILED" };

  const { data: verified, error: verifyError } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });

  // Fail closed (rule 7): anything but exactly the approved student puts the
  // operator back where they were rather than leaving them in some session.
  if (verifyError || verified.user?.id !== params.studentProfileId) {
    if (verified.session) await supabase.auth.signOut({ scope: "local" });
    await supabase.auth.setSession({
      access_token: operator.access_token,
      refresh_token: operator.refresh_token,
    });
    return { ok: false, reason: "VERIFY_FAILED" };
  }

  const store = await cookies();
  const marker: ImpersonationMarker = {
    operatorProfileId: params.operatorProfileId,
    studentProfileId: params.studentProfileId,
    tenantId: params.tenantId,
    expiresAt: new Date(Date.now() + IMPERSONATION_TTL_SECONDS * 1000).toISOString(),
  };
  store.set(
    MARKER_COOKIE,
    encodeImpersonationMarker(marker, hmacTokenSigner, markerSecret()),
    cookieOptions,
  );
  store.set(
    OPERATOR_COOKIE,
    JSON.stringify({
      access_token: operator.access_token,
      refresh_token: operator.refresh_token,
    } satisfies OperatorTokens),
    cookieOptions,
  );

  return { ok: true };
}

export type RestoreResult =
  { readonly ok: true; readonly operatorProfileId: string } | { readonly ok: false };

/**
 * Ends the student session and restores the operator's.
 *
 * `scope: "local"` is essential: the default signs the account out
 * *everywhere*, which would log the real student out of the app on their own
 * phone in the middle of a meal.
 */
export async function restoreOperatorSession(
  supabase: SupabaseClient<Database>,
  marker: ImpersonationMarker,
): Promise<RestoreResult> {
  const store = await cookies();
  const raw = store.get(OPERATOR_COOKIE)?.value;
  clearImpersonationCookies(store);

  await supabase.auth.signOut({ scope: "local" });

  let tokens: OperatorTokens | null = null;
  try {
    const parsed = raw ? (JSON.parse(raw) as Partial<OperatorTokens>) : null;
    if (typeof parsed?.access_token === "string" && typeof parsed.refresh_token === "string") {
      tokens = { access_token: parsed.access_token, refresh_token: parsed.refresh_token };
    }
  } catch {
    tokens = null;
  }
  if (!tokens) return { ok: false };

  const { data, error } = await supabase.auth.setSession(tokens);
  // The restored session must be the operator named in the marker. Anything
  // else — a stale cookie, a swapped value — is signed straight back out.
  if (error || data.user?.id !== marker.operatorProfileId) {
    if (data.session) await supabase.auth.signOut({ scope: "local" });
    return { ok: false };
  }

  return { ok: true, operatorProfileId: marker.operatorProfileId };
}

function clearImpersonationCookies(store: Awaited<ReturnType<typeof cookies>>): void {
  store.delete(MARKER_COOKIE);
  store.delete(OPERATOR_COOKIE);
}

/** For sign-out: an ended session must not leave the way back lying around. */
export async function discardImpersonation(): Promise<void> {
  clearImpersonationCookies(await cookies());
}
