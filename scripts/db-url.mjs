#!/usr/bin/env node
/**
 * Composes the Postgres connection string for the Supabase CLI.
 *
 * Exists for two reasons, both learned the hard way against this project:
 *
 * 1. **Percent-encoding.** The CLI's `--db-url` requires it, and a password
 *    containing `@`, `#`, `/` or `:` silently produces a malformed URL that
 *    fails with a confusing host-parse error rather than "bad password". The
 *    password is encoded here so nobody has to remember.
 *
 * 2. **IPv4 pooler, not direct.** Supabase serves direct connections
 *    (`db.<ref>.supabase.co:5432`) over IPv6 only. Many networks — including
 *    this project's — route IPv6 for HTTPS but block or fail to route TCP 5432,
 *    producing "no route to host". The session-mode pooler is IPv4 and works.
 *
 * Keeping the password in exactly one place (SUPABASE_DB_PASSWORD) rather than
 * duplicating it into a second URL variable means one thing to rotate.
 */
import { loadEnv } from "./load-env.mjs";

loadEnv();

const ref = process.env.SUPABASE_PROJECT_REF;
const password = process.env.SUPABASE_DB_PASSWORD;
// Region of the project's pooler. Discovered per project; ap-south-1 (Mumbai)
// for this one. Visible in the dashboard under Connect > Session pooler.
const region = process.env.SUPABASE_DB_REGION ?? "ap-south-1";
const prefix = process.env.SUPABASE_DB_POOLER_PREFIX ?? "aws-1";

if (!ref || !password) {
  console.error(
    "Missing SUPABASE_PROJECT_REF or SUPABASE_DB_PASSWORD.\n" +
      "Fill them in .env.local — see docs/RUNBOOK.md §1.",
  );
  process.exit(1);
}

const host = `${prefix}-${region}.pooler.supabase.com`;
// Session mode (5432), not transaction mode (6543): migrations run DDL and
// multi-statement transactions that transaction pooling does not support.
process.stdout.write(
  `postgresql://postgres.${ref}:${encodeURIComponent(password)}@${host}:5432/postgres`,
);
