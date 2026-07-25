/**
 * Environment configuration, validated at the boundary (rule 10).
 *
 * Split deliberately into two schemas:
 *
 * - `publicEnv` is safe for the browser. Only `NEXT_PUBLIC_*` values, protected
 *   by RLS rather than by secrecy.
 * - `serverEnv` holds secrets and is guarded by `server-only`, so importing it
 *   from a client component is a **build error**, not a runtime surprise that
 *   ships the service-role key to every student's phone.
 *
 * Both parse eagerly at module load. A missing variable should crash the app at
 * boot with a readable message, not produce `undefined` that surfaces hours
 * later as a confusing auth failure at the counter.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Public — safe to reach the browser
// ---------------------------------------------------------------------------

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url("Must be the full https URL of the Supabase project"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(20, "Publishable/anon key looks truncated")
    // Accepts both the modern `sb_publishable_…` format and the legacy anon JWT.
    .refine(
      (v) => v.startsWith("sb_publishable_") || v.startsWith("eyJ"),
      "Expected a publishable key (sb_publishable_…) or a legacy anon JWT",
    )
    .refine(
      (v) => !v.startsWith("sb_secret_"),
      "This is a SECRET key. It must never be exposed as NEXT_PUBLIC_.",
    ),
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
});

/**
 * Next.js inlines `process.env.NEXT_PUBLIC_*` at build time only when accessed
 * as a full static member expression, so these cannot be read dynamically.
 */
const parsedPublic = publicSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});

if (!parsedPublic.success) {
  throw new Error(
    `Invalid public environment configuration:\n${formatIssues(parsedPublic.error)}\n` +
      `Check .env against .env.example (see docs/RUNBOOK.md §1).`,
  );
}

export const publicEnv = parsedPublic.data;

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
}

export type PublicEnv = typeof publicEnv;
