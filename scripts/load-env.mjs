/**
 * Loads `.env` into process.env for the standalone scripts.
 *
 * Next.js does this automatically for app code; plain `node scripts/*.mjs`
 * does not. Shared by db-url, seal-migrations and verify-schema so the parsing
 * lives in one place — a seal record reading "unknown-project" because one
 * script forgot to load the env is a migration audit trail that lies.
 *
 * `.env` is the single source of credentials for this project, deliberately
 * chosen over `.env.local` so that migrations always resolve the same file no
 * matter which tool invokes them. Note that Next.js gives `.env.local` HIGHER
 * precedence than `.env`: if a stray `.env.local` ever reappears, the app would
 * read it while these scripts read `.env`, and you would be migrating one
 * database while the app talks to another. The warning below catches that.
 *
 * Existing environment variables win, so CI can override without a file.
 */
import { readFileSync, existsSync } from "node:fs";

export function loadEnv(file = ".env") {
  if (existsSync(".env.local")) {
    console.warn(
      "\x1b[33m⚠ .env.local exists and Next.js will prefer it over .env.\x1b[0m\n" +
        "  These scripts read .env only. Delete .env.local to avoid pointing the app\n" +
        "  and your migrations at different databases.",
    );
  }
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] === undefined) {
      process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
    }
  }
}
