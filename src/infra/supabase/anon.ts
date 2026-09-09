/**
 * Anonymous Supabase client — anon key, no session, no cookies.
 *
 * For the one moment that is neither: exchanging a password for a token, before
 * any session exists. The web equivalent uses the cookie-backed client from
 * `server.ts` because signing in there must *write* the session cookies; a
 * mobile client wants the tokens handed back in the response body instead, and
 * must not leave a cookie behind on the server's request.
 *
 * `persistSession: false` matters more here than it looks. This runs on a warm
 * serverless instance shared between requests, so a client that remembered the
 * last sign-in would be a session leak from one user to the next.
 */
import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import type { Database } from "./database.types";

export function createAnonClient() {
  return createSupabaseClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    },
  );
}
