#!/usr/bin/env tsx
/**
 * Refuses a store build that would ship Google's sample AdMob ids (D-35).
 *
 * The failure this prevents is silent and expensive: sample ids serve real test
 * banners to real students, occupying real screen space, and earn exactly
 * nothing. Nothing in the app looks wrong — ads appear, they just are not
 * yours — so it would be found weeks later by noticing the revenue is zero.
 *
 * Run before cutting a release. Not part of `npm run verify`, because sample
 * ids are the correct state while developing.
 *
 * Usage: npm run verify:release-ads
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const config = JSON.parse(readFileSync(join(root, "app.config.json"), "utf8")) as {
  admob: { androidAppId: string; iosAppId: string };
};

/** Google's public demo publisher. Anything under it is a test id. */
const SAMPLE_PUBLISHER = "ca-app-pub-3940256099942544";

const offenders = Object.entries(config.admob)
  .filter(([key]) => key.endsWith("AppId"))
  .filter(([, id]) => typeof id === "string" && id.startsWith(SAMPLE_PUBLISHER));

if (offenders.length === 0) {
  console.log("\n\x1b[32m✔ Real AdMob app ids are in place.\x1b[0m\n");
  process.exit(0);
}

console.error(
  `\n\x1b[31m✖ This build would ship Google's SAMPLE AdMob ids.\x1b[0m\n\n` +
    offenders.map(([key, id]) => `    ${key}: ${id}`).join("\n") +
    `\n\n  Students would see test banners and you would earn nothing.\n` +
    `  Put the real ids in app.config.json and run \`npm run app:name\`.\n` +
    `  Ad UNIT ids are not here — they live at /superuser/app-config.\n`,
);
process.exit(1);
