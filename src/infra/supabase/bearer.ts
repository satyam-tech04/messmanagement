/**
 * Bearer-token Supabase client — anon key + a caller-supplied access token, so
 * RLS applies as that user exactly as it does for a cookie session.
 *
 * This is the mobile transport's equivalent of `server.ts`. The only difference
 * is where the token comes from: a native app has no cookie jar, so it sends
 * `Authorization: Bearer <access_token>` and the token rides on every PostgREST
 * request in the `global.headers` below.
 *
 * Nothing about authorization changes. PostgREST reads the same JWT, populates
 * the same `request.jwt.claims`, and the same `app.current_tenant_id()` helpers
 * behind all 30 RLS policies resolve identically. `scripts/verify-jwt-hook.mjs`
 * already proves a bearer token yields correct tenant isolation against
 * `/rest/v1/` — this client is that same request path, typed.
 *
 * Note what this client is NOT: it is not privileged. Unlike `admin.ts` it holds
 * the anon key, so a bug here fails closed against RLS rather than leaking
 * across tenants.
 */
import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import type { Database } from "./database.types";

export function createBearerClient(accessToken: string) {
  return createSupabaseClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      global: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      auth: {
        // The token arrives per request and is never stored. Persisting or
        // refreshing it here would leak one caller's session into another's on
        // a warm serverless instance — the client is a request-scoped value,
        // not a logged-in user. The app refreshes its own token instead.
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    },
  );
}
