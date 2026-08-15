/**
 * Every rendered date and time must name its timezone.
 *
 * `Intl.DateTimeFormat` and `toLocaleString` fall back to *the device's* zone
 * when none is given. On a server that is whatever the host is set to; in a
 * browser it is wherever the student happens to be. Either way the mess's own
 * clock stops being the source of truth, and the failure is silent — the time
 * still renders, it is simply wrong.
 *
 * This already happened once: the student's QR screen showed meal opening times
 * in the phone's timezone rather than the hostel's.
 *
 * A lint rule cannot express "this argument object must contain a key", so this
 * is a test. It reads the source rather than executing it, which is unusual but
 * is the only way to catch the omission at the point it is written.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      // Generated types carry no formatting.
      if (entry === "node_modules" || entry === ".next") continue;
      out.push(...sourceFiles(path));
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith("database.types.ts")) {
      out.push(path);
    }
  }
  return out;
}

/** Returns the argument text of every date-formatting call in `source`. */
function formattingCalls(source: string): { call: string; line: number }[] {
  const found: { call: string; line: number }[] = [];
  const pattern = /(?:new Intl\.DateTimeFormat\(|\.toLocale(?:Date|Time)?String\()/g;

  for (const match of source.matchAll(pattern)) {
    let depth = 1;
    let i = match.index! + match[0].length;
    while (i < source.length && depth > 0) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")") depth--;
      i++;
    }
    found.push({
      call: source.slice(match.index!, i),
      line: source.slice(0, match.index!).split("\n").length,
    });
  }
  return found;
}

describe("no date or time is rendered without an explicit timezone", () => {
  const files = sourceFiles("src");

  it("finds source files to check, so a broken scan cannot pass silently", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("has at least one formatting call to inspect", () => {
    const total = files.reduce((n, f) => n + formattingCalls(readFileSync(f, "utf8")).length, 0);
    expect(total).toBeGreaterThan(3);
  });

  it("names a timezone at every call site", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const { call, line } of formattingCalls(source)) {
        // A formatter built from a variable zone is fine — that IS the tenant's.
        if (call.includes("timeZone")) continue;
        offenders.push(`${file}:${line}`);
      }
    }

    expect(
      offenders,
      `These render a date or time in the device's timezone rather than the mess's:\n` +
        offenders.map((o) => `  - ${o}`).join("\n") +
        `\n\nPass \`timeZone\` — the tenant's, from \`user.timezone\`. For a plain ` +
        `calendar date with no instant behind it, build with \`Date.UTC(...)\` and ` +
        `read back with \`timeZone: "UTC"\`, which shifts nothing.`,
    ).toEqual([]);
  });
});

describe("service dates are never derived from a UTC instant", () => {
  const files = sourceFiles("src");

  it("nothing slices an ISO string to get a calendar date", () => {
    // `toISOString().slice(0, 10)` converts local to UTC first, so for an IST
    // hostel it reports the previous day for most of the working day. Shipped
    // twice in this repository before `src/core/time` existed.
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((text, index) => {
        if (text.trimStart().startsWith("*") || text.trimStart().startsWith("//")) return;
        if (/toISOString\(\)\s*\.\s*slice\(\s*0\s*,\s*10\s*\)/.test(text)) {
          offenders.push(`${file}:${index + 1}`);
        }
      });
    }

    expect(
      offenders,
      `These derive a calendar date from a UTC instant:\n` +
        offenders.map((o) => `  - ${o}`).join("\n") +
        `\n\nUse \`serviceDateOf(tenantTimezone, instant)\` from \`src/core/time\`.`,
    ).toEqual([]);
  });
});
