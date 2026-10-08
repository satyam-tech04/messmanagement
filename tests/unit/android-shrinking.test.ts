/**
 * The release build keeps what R8 would otherwise strip.
 *
 * The first store build (1.0.0+1) died on open on every phone. WorkManager —
 * brought in by the ads SDK — creates its Room database by reflection as the
 * process starts, and R8 had removed the constructor it calls. Debug builds do
 * not shrink, so nothing failed until the bundle was on students' phones.
 *
 * The fix is one keep rule and the line that feeds it to the build. Losing
 * either fails nowhere except on a phone, so both are pinned here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const app = join(import.meta.dirname, "../../mobile/android/app");
const rules = readFileSync(join(app, "proguard-rules.pro"), "utf8")
  .split("\n")
  .filter((line) => !line.trim().startsWith("#"))
  .join("\n");
const gradle = readFileSync(join(app, "build.gradle.kts"), "utf8");

describe("code shrinking in the Android release build", () => {
  it("keeps the constructor Room calls by reflection", () => {
    expect(rules).toMatch(
      /-keep\s+class\s+\*\s+extends\s+androidx\.room\.RoomDatabase\s*\{\s*<init>\(\);\s*\}/,
    );
  });

  it("feeds the rules file to the release build", () => {
    const release = /release\s*\{[\s\S]*?\n {4}\}/.exec(gradle)?.[0] ?? "";
    expect(release).toMatch(/proguardFiles\([\s\S]*"proguard-rules\.pro"/);
  });
});
