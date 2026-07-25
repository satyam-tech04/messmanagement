/**
 * Admin Supabase client — service role key. **BYPASSES RLS COMPLETELY.**
 *
 * This client can read and write every tenant's data. There is no database-level
 * safety net behind it; the application layer is the only thing standing between
 * a bug here and a cross-tenant data leak (§5.1, §5.3).
 *
 * Use it ONLY where the anon+session client genuinely cannot work:
 *
 * - reading `tenant_secrets` (RLS-enabled with zero policies by design)
 * - `auth.admin` user creation, for admin-issued student credentials (D-02)
 * - resolving a roll number to a login identity **before** a session exists
 * - the rate limiter, which a client must not be able to reset
 * - cron jobs, which run with no user session at all
 *
 * Every call site must filter by `tenant_id` explicitly. RLS will not do it for
 * you here. If you find yourself reaching for this client for ordinary reads,
 * that is a sign the query belongs on the server client instead.
 */
import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";
import type { Database } from "./database.types";

export function createAdminClient() {
  return createSupabaseClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        // No session handling: this client is never "a user". Persisting or
        // refreshing a session here would be meaningless and could leak state
        // between requests on a warm serverless instance.
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    },
  );
}
