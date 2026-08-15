/**
 * Server Supabase client — anon key + the user's session cookies, so RLS
 * applies as that user.
 *
 * This is the default choice for Server Components, Server Actions and route
 * handlers. Because it carries the session, every query is filtered by the
 * caller's `tenant_id` claim at the database level — a second line of defence
 * behind the application's own tenant checks (§5.1).
 *
 * Next 16 note: `cookies()` is async-only; the Next 15 synchronous shim is gone.
 */
import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { persistentCookieOptions } from "../auth/session-lifetime";
import { publicEnv } from "@/lib/env";
import type { Database } from "./database.types";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet, headers) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              // Persistent, so a closed browser or a rebooted counter tablet
              // does not sign anyone out. See session-lifetime.ts.
              cookieStore.set(name, value, persistentCookieOptions(value, options));
            }
            // Responses that set auth cookies must never be cached by a CDN,
            // or one user's session token can be served to another. The
            // library hands us the correct no-store headers; apply them.
            for (const [key, value] of Object.entries(headers ?? {})) {
              cookieStore.set(key, value);
            }
          } catch {
            // Server Components cannot set cookies. That is expected and safe:
            // `proxy.ts` refreshes the session on every request, so the
            // refreshed token is already written there. Swallowing this is the
            // documented pattern, not a shortcut.
          }
        },
      },
    },
  );
}
