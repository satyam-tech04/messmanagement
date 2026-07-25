#!/usr/bin/env node
/**
 * Marks every pending migration as `applied` in supabase/migrations/checksums.json.
 * Run this immediately after a successful `npm run db:push`.
 *
 * From that point on, editing the file is a pre-commit failure — see
 * scripts/check-migrations.mjs for why that matters when pushing to a hosted
 * project with live student data.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv } from "./load-env.mjs";

loadEnv();

const MIGRATIONS_DIR = "supabase/migrations";
const LOCKFILE = "supabase/migration-checksums.json";
const target = process.env.SUPABASE_PROJECT_REF ?? "unknown-project";

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const lock = existsSync(LOCKFILE) ? JSON.parse(readFileSync(LOCKFILE, "utf8")) : {};

const sealed = [];
for (const file of readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  const hash = sha256(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  if (lock[file]?.state === "applied" && lock[file].sha256 === hash) continue;
  lock[file] = {
    sha256: hash,
    state: "applied",
    appliedTo: target,
    appliedAt: new Date().toISOString().slice(0, 10),
  };
  sealed.push(file);
}

writeFileSync(LOCKFILE, JSON.stringify(lock, null, 2) + "\n");
console.log(
  sealed.length
    ? `✔ Sealed ${sealed.length} migration(s) against ${target}:\n  ${sealed.join("\n  ")}`
    : "✔ No pending migrations to seal.",
);
