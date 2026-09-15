/**
 * Server-only environment. Importing this from a client component is a BUILD
 * ERROR, courtesy of `server-only` (§5.3).
 *
 * That guard is the whole point of the separate file. `SUPABASE_SERVICE_ROLE_KEY`
 * bypasses RLS entirely — it reads and writes every tenant's data. A single
 * careless import into a shared module would ship it in the client bundle to
 * every student's phone, and nothing at runtime would complain.
 */
import "server-only";
import { z } from "zod";

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(20, "Service role key looks truncated")
    .refine(
      (v) => v.startsWith("sb_secret_") || v.startsWith("eyJ"),
      "Expected a secret key (sb_secret_…) or a legacy service_role JWT",
    ),

  /**
   * Fallback QR signing secret, used when a tenant has no row in
   * `tenant_secrets`. Per-tenant secrets are preferred and rotatable; this
   * exists so a freshly provisioned tenant is never left unable to issue codes.
   *
   * 32 characters is the floor for an HMAC-SHA256 key worth having.
   */
  QR_SIGNING_SECRET: z.string().min(32, "Use at least 32 chars: openssl rand -base64 48"),

  /** Guards /api/cron/*; the scheduler sends it as the `x-cron-secret` header (§9). */
  CRON_SECRET: z.string().min(16, "Use at least 16 chars: openssl rand -base64 32"),

  /**
   * When "true", only admins and the platform operator may sign in on the
   * website; students and counter staff are sent to the MealAdda app.
   *
   * Off by default, deliberately. A mess whose students have not installed the
   * app yet would lose its web QR codes the moment this turned on, so it is a
   * decision taken per deployment once the app is in their hands — not a side
   * effect of shipping the code.
   */
  WEB_SIGNIN_APP_ONLY: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // --- Migration tooling. Absent in a deployed runtime, which is fine. ---
  SUPABASE_PROJECT_REF: z.string().optional(),
  SUPABASE_DB_PASSWORD: z.string().optional(),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

const parsed = serverSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(
    `Invalid server environment configuration:\n` +
      parsed.error.issues
        .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n") +
      `\nCheck .env against .env.example (see docs/RUNBOOK.md §1).`,
  );
}

export const serverEnv = parsed.data;
export type ServerEnv = typeof serverEnv;

export const isProduction = serverEnv.NODE_ENV === "production";
