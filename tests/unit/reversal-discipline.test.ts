/**
 * `reversed_at` belongs to `attendance`, and every attendance read must filter
 * on it.
 *
 * Both halves of that sentence failed at once on the student home page, in
 * production, for a live tenant. The filter had been attached to the `menus`
 * query instead of the `attendance` one directly below it, which produced two
 * separate faults from a single misplaced line:
 *
 *   1. `menus` has no such column, so Postgres answered 42703 and today's menu
 *      silently disappeared from every student's screen.
 *   2. the attendance query then counted reversed rows as real, so a student
 *      whose wrong scan an admin had just corrected was still shown as having
 *      eaten — and could not be served.
 *
 * The second one is the expensive one: correcting a mistake left the student
 * unable to get their meal, which is precisely what the reversal feature exists
 * to undo.
 *
 * This reads the source rather than executing it. A type checker cannot catch
 * it — the Supabase client accepts any column name as a string — and a runtime
 * test would need every page rendered against a live database. Scanning is what
 * catches it at the point it is written.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      out.push(...sourceFiles(path));
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith("database.types.ts")) {
      out.push(path);
    }
  }
  return out;
}

/**
 * Splits a file into PostgREST query chains, each tagged with its table.
 *
 * A chain starts at `.from("table")` and runs to the next one, which is how the
 * builder reads: every `.eq`/`.is` after a `.from` applies to that table.
 */
function queryChains(source: string): { table: string; body: string; line: number }[] {
  const chains: { table: string; body: string; line: number }[] = [];
  const pattern = /\.from\(\s*["'`](\w+)["'`]\s*\)/g;

  const matches = [...source.matchAll(pattern)];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]!;
    const start = match.index!;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : source.length;
    chains.push({
      table: match[1]!,
      body: source.slice(start, end),
      line: source.slice(0, start).split("\n").length,
    });
  }
  return chains;
}

const files = sourceFiles("src");

describe("reversed_at is only ever applied to tables that have it", () => {
  it("finds query chains to inspect, so a broken scan cannot pass silently", () => {
    const total = files.reduce((n, f) => n + queryChains(readFileSync(f, "utf8")).length, 0);
    expect(total).toBeGreaterThan(10);
  });

  it("never references reversed_at on a table without the column", () => {
    // Only `attendance` has it. Migration 006 added it there and nowhere else.
    const offenders: string[] = [];

    for (const file of files) {
      for (const chain of queryChains(readFileSync(file, "utf8"))) {
        if (chain.table === "attendance") continue;
        if (/reversed_at|reversal_reason/.test(chain.body)) {
          offenders.push(`${file}:${chain.line} — .from("${chain.table}")`);
        }
      }
    }

    expect(
      offenders,
      `These filter or select reversed_at on a table that has no such column, ` +
        `which Postgres rejects with 42703 and the page loses its data:\n` +
        offenders.map((o) => `  - ${o}`).join("\n"),
    ).toEqual([]);
  });
});

describe("every attendance read excludes reversed rows", () => {
  it("filters reversed_at on each attendance query", () => {
    // A reversed meal never happened. Counting one means a student who was
    // wrongly scanned, and then corrected, is refused their actual meal — and
    // means the kitchen's headcount is wrong in the direction that leaves
    // someone unfed.
    const offenders: string[] = [];

    for (const file of files) {
      for (const chain of queryChains(readFileSync(file, "utf8"))) {
        if (chain.table !== "attendance") continue;

        // Writes and the reversal flow itself are exempt: an INSERT has nothing
        // to filter, and the admin's correction screen must be able to SEE
        // reversed rows in order to show what was corrected.
        const isWrite = /\.(insert|upsert|update|delete)\(/.test(chain.body);
        const readsTheColumn = /reversed_at/.test(chain.body);
        if (isWrite || readsTheColumn) continue;

        offenders.push(`${file}:${chain.line}`);
      }
    }

    expect(
      offenders,
      `These read attendance without excluding reversed rows, so a corrected ` +
        `scan still counts as a meal served:\n` +
        offenders.map((o) => `  - ${o}`).join("\n") +
        `\n\nAdd \`.is("reversed_at", null)\`, or select the column if the screen ` +
        `deliberately shows corrections.`,
    ).toEqual([]);
  });
});
