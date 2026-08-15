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
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { loadEnv } from "./load-env.mjs";

loadEnv();

const MIGRATIONS_DIR = "supabase/migrations";
const LOCKFILE = "supabase/migration-checksums.json";
const target = process.env.SUPABASE_PROJECT_REF ?? "unknown-project";

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const lock = existsSync(LOCKFILE) ? JSON.parse(readFileSync(LOCKFILE, "utf8")) : {};

/**
 * Which migrations the database says it actually ran.
 *
 * Sealing used to trust that `db:push` had succeeded, so a failed push followed
 * by a seal marked a migration immutable that had never applied — after which
 * fixing the file was a pre-commit failure. Ask the database instead.
 */
const client = new pg.Client({
  connectionString: execSync("node scripts/db-url.mjs", { encoding: "utf8" }).trim(),
});
await client.connect();
const { rows } = await client.query("select version from supabase_migrations.schema_migrations");
await client.end();
const appliedVersions = new Set(rows.map((r) => r.version));

const sealed = [];
const skipped = [];
for (const file of readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  const hash = sha256(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  if (lock[file]?.state === "applied" && lock[file].sha256 === hash) continue;

  // A migration the database never ran must stay editable — that is the whole
  // point of the immutability rule, and sealing an unapplied file inverts it.
  const version = file.split("_")[0];
  if (!appliedVersions.has(version)) {
    skipped.push(file);
    continue;
  }
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

if (skipped.length) {
  console.error(
    `\n✖ NOT sealed — the database has no record of running these:\n  ${skipped.join("\n  ")}\n` +
      `  Run \`npm run db:push\` and check it succeeded before sealing.`,
  );
  process.exit(1);
}
