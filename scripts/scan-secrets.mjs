#!/usr/bin/env node
/**
 * Staged-content secret scanner.
 *
 * Checks whether any real credential from `.env` appears in what is about to be
 * committed. Deliberately value-based rather than pattern-based: an earlier
 * pattern-matching version flagged the string literal `"sb_secret_"` inside the
 * env *validator* as a leak, which is the classic false positive that trains
 * people to bypass the check. Matching on the actual values has no such problem
 * — if the literal secret is not in the diff, there is nothing to report.
 *
 * Short values are skipped: a 6-character secret would match half the codebase
 * by coincidence, and anything that short is not a credential worth protecting.
 *
 * Run from the pre-commit hook. Exits non-zero if anything is found.
 */
import { execSync } from "node:child_process";
import { loadEnv } from "./load-env.mjs";

const MIN_LENGTH = 16;

// Values that are public by design and safe to appear in code or docs.
const PUBLIC_BY_DESIGN = new Set([
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_APP_URL",
  "SUPABASE_PROJECT_REF",
  "SUPABASE_DB_REGION",
  "SUPABASE_DB_POOLER_PREFIX",
]);

const before = new Set(Object.keys(process.env));
loadEnv();

const staged = execSync("git diff --cached", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
if (!staged.trim()) process.exit(0);

const findings = [];
for (const [key, value] of Object.entries(process.env)) {
  // Only consider variables that came from .env, not the ambient shell.
  if (before.has(key)) continue;
  if (PUBLIC_BY_DESIGN.has(key)) continue;
  if (!value || value.length < MIN_LENGTH) continue;
  if (staged.includes(value)) findings.push(key);
}

// Regardless of .env contents, the credentials file itself must never be staged.
const stagedFiles = execSync("git diff --cached --name-only", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
const envFiles = stagedFiles.filter((f) => /^\.env(\.|$)/.test(f) && f !== ".env.example");

if (findings.length || envFiles.length) {
  console.error("\n\x1b[31m✖ Secret detected in staged content\x1b[0m\n");
  for (const key of findings) {
    console.error(`  the value of ${key} appears in the diff`);
  }
  for (const file of envFiles) {
    console.error(`  ${file} is staged and must never be committed`);
  }
  console.error(
    "\nUnstage it, remove the value, and if it already reached a remote treat it as\n" +
      "compromised and rotate it (see docs/RUNBOOK.md §5).\n",
  );
  process.exit(1);
}

process.exit(0);
