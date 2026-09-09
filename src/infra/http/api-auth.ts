/**
 * Authentication for JSON endpoints, across both transports.
 *
 * A route handler is reachable two ways now: a browser with a session cookie,
 * and the mobile app with `Authorization: Bearer <access_token>`. Both resolve
 * to the same `SessionUser`, so nothing downstream — no use case, no policy, no
 * repository — has to know which one it is talking to.
 *
 * **It returns the Supabase client as well as the user, and callers must use
 * it.** This is the part that is easy to get wrong: a bearer request carries no
 * cookie, so the cookie-backed client from `server.ts` would run every query as
 * anonymous and RLS would refuse the lot. The two facts — who is calling, and
 * which client speaks for them — belong together, so handing them back
 * separately is how a route ends up authenticating one way and querying another.
 *
 * The rule about who may proceed lives in `api-auth-decision.ts`, kept pure and
 * tested. This file is only the I/O.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSessionUser, getSessionUserFromToken, type SessionUser } from "@/infra/auth/session";
import { createBearerClient } from "@/infra/supabase/bearer";
import { createClient } from "@/infra/supabase/server";
import type { Database } from "@/infra/supabase/database.types";
import { parseBearerToken } from "@/lib/bearer-token";
import { apiAuthDecision, type ApiAuthFailure, type ApiAuthOptions } from "./api-auth-decision";

export {
  apiAuthDecision,
  type ApiAuth,
  type ApiAuthFailure,
  type ApiAuthOptions,
} from "./api-auth-decision";

/** An authenticated caller and the client that speaks for them. */
export interface ApiCaller {
  readonly user: SessionUser;
  /** RLS applies as this user. Use it for every query in the handler. */
  readonly supabase: SupabaseClient<Database>;
}

export type ApiAuthResult = { readonly ok: true; readonly caller: ApiCaller } | ApiAuthFailure;

/**
 * The guard every JSON endpoint should call first.
 *
 * A bearer token wins when present. Falling back to the cookie keeps the
 * existing browser callers of `/api/qr/*` working unchanged — they were never
 * sending a header and must not have to start.
 */
export async function authenticateApiRequest(
  request: Request,
  options: ApiAuthOptions = {},
): Promise<ApiAuthResult> {
  const token = parseBearerToken(request.headers.get("authorization"));

  // Constructing a client is object work, not I/O, so building one here and
  // letting the session lookup build its own costs nothing measurable. The
  // profile query behind that lookup is the expensive part, and it is memoised
  // per token by `cache()`.
  const supabase = token ? createBearerClient(token) : await createClient();
  const user = token ? await getSessionUserFromToken(token) : await getSessionUser();

  const decision = apiAuthDecision(user, options);
  if (!decision.ok) return decision;

  return { ok: true, caller: { user: decision.user, supabase } };
}
