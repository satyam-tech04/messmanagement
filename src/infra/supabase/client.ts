/**
 * Browser Supabase client — anon key, subject to RLS.
 *
 * Safe to use in client components. The anon key is public by design; RLS and
 * the JWT claims injected by `custom_access_token_hook` are what protect the
 * data, not the secrecy of this key.
 *
 * Use this only for things that genuinely need to run in the browser:
 * realtime subscriptions (the live headcount) and the QR screen's token
 * refresh. Everything else should go through a Server Component or Server
 * Action, where the tenant context is derived server-side.
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
