#!/usr/bin/env node
/**
 * Migration immutability guard (architecture doc §13.5).
 *
 * "One migration per logical change, sequentially numbered, never edited after
 * being applied to any environment."
 *
 * Migrations here are pushed straight at a hosted Supabase project, so an edit
 * to an already-applied file is silent: `supabase db push` skips it, your local
 * SQL says one thing and production does another, and the drift only surfaces
 * weeks later as a confusing bug. This hook makes that edit a hard failure.
 *
 * Workflow:
 *   1. Write a NEW migration file. Commit it. The hook records its checksum as
 *      `pending`.
 *   2. Run `npm run db:push`, then `npm run db:seal` to mark it `applied`.
 *   3. From then on, any change to that file fails this check. Write a new
 *      migration instead.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";
const LOCKFILE = "supabase/migration-checksums.json";

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

if (!existsSync(MIGRATIONS_DIR)) process.exit(0);

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const lock = existsSync(LOCKFILE) ? JSON.parse(readFileSync(LOCKFILE, "utf8")) : {};
const violations = [];
let touched = false;

for (const file of files) {
  const hash = sha256(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  const record = lock[file];

  if (!record) {
    lock[file] = { sha256: hash, state: "pending" };
    touched = true;
    continue;
  }
  if (record.sha256 === hash) continue;

  if (record.state === "applied") {
    violations.push(
      `  ${file}\n` +
        `    was edited after being applied to ${record.appliedTo ?? "an environment"}` +
        `${record.appliedAt ? ` on ${record.appliedAt}` : ""}.`,
    );
  } else {
    // Still pending — editing before it ships anywhere is fine.
    lock[file] = { ...record, sha256: hash };
    touched = true;
  }
}

// A file disappearing is as dangerous as an edit: the DB still has its effects.
for (const file of Object.keys(lock)) {
  if (!files.includes(file) && lock[file].state === "applied") {
    violations.push(`  ${file}\n    was deleted but is already applied to a live database.`);
  }
}

if (violations.length > 0) {
  console.error("\n\x1b[31m✖ Migration immutability violated\x1b[0m\n");
  console.error(violations.join("\n"));
  console.error(
    "\nApplied migrations are history, not source. `supabase db push` will NOT re-run\n" +
      "them, so this edit changes your repo without changing the database.\n\n" +
      "Fix: revert the file and add a NEW migration with the change.\n" +
      "Escape hatch (only if it truly never reached any database):\n" +
      `  edit ${LOCKFILE} and set that file's "state" back to "pending".\n`,
  );
  process.exit(1);
}

if (touched) {
  writeFileSync(LOCKFILE, JSON.stringify(lock, null, 2) + "\n");
  console.log(`✔ Recorded migration checksums in ${LOCKFILE}`);
}

process.exit(0);
