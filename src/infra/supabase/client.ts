/**
 * Browser Supabase client — anon key, subject to RLS.
 *
 * Safe to use in client components. The anon key is public by design; RLS and
 * the JWT claims injected by `custom_access_token_hook` are what protect the
 * data, not the secrecy of this key.
 *
 * Use this only for things that genuinely need to run in the browser:
 * realtime subscriptions (the live headcount, the student's own scan) and the
 * QR screen's token refresh. Everything else should go through a Server
 * Component or Server Action, where the tenant context is derived server-side.
 */
import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";
import type { Database } from "./database.types";

export function createClient() {
  return createBrowserClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * A client whose **realtime socket** knows who the user is.
 *
 * RLS applies to realtime, and the socket authenticates separately from the
 * REST calls: it must be handed the access token or Postgres evaluates the
 * subscription as anonymous and silently delivers nothing. No error, no failed
 * subscription — the channel reports SUBSCRIBED and simply never fires.
 *
 * `signInWithPassword` calls `setAuth` internally, which is why this is easy to
 * miss in a script and then fail in a browser, where the session is restored
 * from cookies instead. Measured both ways against the live project:
 *
 *     socket authed with user JWT   push received: YES
 *     socket left on the anon key   push received: NO
 *
 * Returns null when there is no session, so the caller can skip subscribing
 * rather than opening a socket that can never deliver anything.
 */
export async function createRealtimeClient() {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  if (!data.session) return null;

  supabase.realtime.setAuth(data.session.access_token);
  return supabase;
}
