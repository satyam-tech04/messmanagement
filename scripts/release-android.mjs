#!/usr/bin/env node
/**
 * Builds the Play Store bundle — checked, tested, signed and filed.
 *
 *   npm run release:android                        # production: needs real AdMob ids
 *   npm run release:android -- --allow-sample-ads  # closed test on Google's test ads
 *
 * In order, stopping at the first failure:
 *
 *   1. Preflight — clean git tree, upload keystore readable, Firebase config for
 *      this package, AdMob ids (sample ids only with --allow-sample-ads, and the
 *      bundle is then labelled closed-test), and a build number not already filed.
 *   2. Tests — `npm run verify` (web + domain), `flutter analyze`, `flutter test`.
 *   3. Build — `flutter build appbundle --release`, Dart symbols split out.
 *   4. Verify — the bundle's signer must be the upload key's certificate. Gradle
 *      falls back to the DEBUG key when key.properties is missing, and Play
 *      refuses that bundle only after a long upload.
 *   5. File — bundle, symbols, R8 mapping, checksums and notes into
 *      ~/Desktop/MealAdda-releases/android/<version>+<build>-<channel>/.
 *
 * API base URL, Supabase URL/anon key and the Firebase project are compiled in
 * from their production defaults (mobile/lib/src/core/config.dart,
 * android/app/google-services.json); nothing is passed on the command line, so
 * there is nothing to forget. See docs/RELEASE-MOBILE.md.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import {
  extractSha256,
  parseProperties,
  parsePubspecVersion,
  releaseChannel,
  releaseName,
} from "./lib/release-android.mjs";

const root = join(import.meta.dirname, "..");
const mobile = join(root, "mobile");
const allowSampleAds = process.argv.includes("--allow-sample-ads");

const step = (msg) => console.log(`\n\x1b[1m▶ ${msg}\x1b[0m`);
const ok = (msg) => console.log(`  \x1b[32m✔\x1b[0m ${msg}`);
const warn = (msg) => console.log(`  \x1b[33m⚠\x1b[0m ${msg}`);
function die(msg) {
  console.error(`\n\x1b[31m✖ ${msg}\x1b[0m\n`);
  process.exit(1);
}
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: "inherit" });
const capture = (cmd, args, cwd = root) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// ── 1. Preflight ────────────────────────────────────────────────────────────
step("Preflight");

if (capture("git", ["status", "--porcelain"]).trim()) {
  die("Working tree is not clean. Commit first, so the bundle maps to exactly one commit.");
}
const commit = capture("git", ["rev-parse", "--short", "HEAD"]).trim();
ok(`Clean tree at ${commit}`);

const appConfig = JSON.parse(readFileSync(join(root, "app.config.json"), "utf8"));
const version = parsePubspecVersion(readFileSync(join(mobile, "pubspec.yaml"), "utf8"));
ok(`${appConfig.name} ${version.name} (build ${version.build}), package ${appConfig.bundleId}`);

const keyPropsPath = join(mobile, "android", "key.properties");
if (!existsSync(keyPropsPath))
  die("mobile/android/key.properties is missing — see docs/RELEASE-MOBILE.md §2.");
const keyProps = parseProperties(readFileSync(keyPropsPath, "utf8"));
if (!keyProps.storeFile || !existsSync(keyProps.storeFile)) {
  die(`Upload keystore not found at ${keyProps.storeFile}.`);
}
let uploadSha;
try {
  uploadSha = extractSha256(
    capture("keytool", [
      "-list",
      "-v",
      "-keystore",
      keyProps.storeFile,
      "-alias",
      keyProps.keyAlias,
      "-storepass",
      keyProps.storePassword,
    ]),
  );
} catch {
  die("keytool could not open the upload keystore with the passwords in key.properties.");
}
if (!uploadSha) die("Could not read the upload certificate's SHA-256.");
ok(`Upload key ${keyProps.keyAlias} — SHA-256 ${uploadSha}`);

const gsPath = join(mobile, "android", "app", "google-services.json");
if (!existsSync(gsPath))
  die("google-services.json is missing — the build would ship without push.");
const gs = JSON.parse(readFileSync(gsPath, "utf8"));
const gsPackages = gs.client.map((c) => c.client_info.android_client_info.package_name);
if (!gsPackages.includes(appConfig.bundleId)) {
  die(
    `google-services.json has no client for ${appConfig.bundleId} (found ${gsPackages.join(", ")}).`,
  );
}
ok(`Firebase project ${gs.project_info.project_id}`);

const stringsXml = readFileSync(
  join(mobile, "android/app/src/main/res/values/strings.xml"),
  "utf8",
);
if (!stringsXml.includes(appConfig.admob.androidAppId)) {
  die("strings.xml's admob_app_id disagrees with app.config.json — run `npm run app:name`.");
}
const gate = releaseChannel({ androidAdMobId: appConfig.admob.androidAppId, allowSampleAds });
if (!gate.ok) die(gate.reason);
const channel = gate.channel;
if (channel === "closed-test") {
  warn("SAMPLE AdMob ids — this bundle serves test ads and is for the CLOSED TEST track only.");
} else {
  ok("Real AdMob app id");
}

const outDir = join(
  homedir(),
  "Desktop",
  "MealAdda-releases",
  "android",
  releaseName(version, channel),
);
if (existsSync(outDir)) {
  die(
    `${outDir} already exists — build ${version.build} was already cut. Bump the +build in mobile/pubspec.yaml.`,
  );
}

// ── 2. Tests ────────────────────────────────────────────────────────────────
step("Web + domain tests (npm run verify)");
run("npm", ["run", "verify"]);

step("Flutter dependencies, analyzer and tests");
run("flutter", ["pub", "get"], mobile);
run("flutter", ["analyze", "--no-fatal-infos"], mobile);
run("flutter", ["test"], mobile);

// ── 3. Build ────────────────────────────────────────────────────────────────
step("Building the release bundle");
const outputs = join(mobile, "build", "app", "outputs");
// Remove last run's artefacts, so a failed build can never be filed as this one.
for (const dir of ["bundle/release", "mapping/release", "native-debug-symbols/release"]) {
  rmSync(join(outputs, dir), { recursive: true, force: true });
}
const symbolsDir = join(mobile, "build", "release-symbols");
rmSync(symbolsDir, { recursive: true, force: true });
run("flutter", ["build", "appbundle", "--release", `--split-debug-info=${symbolsDir}`], mobile);

const aab = join(outputs, "bundle", "release", "app-release.aab");
if (!existsSync(aab)) die(`Build finished but ${aab} is missing.`);

// ── 4. Verify the signature ─────────────────────────────────────────────────
step("Verifying the bundle's signature");
try {
  capture("jarsigner", ["-verify", aab]);
} catch {
  die("jarsigner could not verify the bundle.");
}
const signerSha = extractSha256(capture("keytool", ["-printcert", "-jarfile", aab]));
if (signerSha !== uploadSha) {
  die(`Bundle is signed by ${signerSha}, not the upload key ${uploadSha}. Play would refuse it.`);
}
ok("Signed by the upload key");

// ── 5. File the release ─────────────────────────────────────────────────────
step(`Filing to ${outDir}`);
mkdirSync(outDir, { recursive: true });

const files = [];
const file = (src, name) => {
  copyFileSync(src, join(outDir, name));
  files.push(name);
};
const bundleName = `MealAdda-${version.name}+${version.build}-${channel}.aab`;
file(aab, bundleName);

const mapping = join(outputs, "mapping", "release", "mapping.txt");
if (existsSync(mapping)) file(mapping, "mapping.txt");

const nativeSymbols = join(outputs, "native-debug-symbols", "release", "native-debug-symbols.zip");
if (existsSync(nativeSymbols)) file(nativeSymbols, "native-debug-symbols.zip");

run("zip", ["-qr", join(outDir, "dart-symbols.zip"), "."], symbolsDir);
files.push("dart-symbols.zip");

const sums = files
  .map(
    (name) =>
      `${createHash("sha256")
        .update(readFileSync(join(outDir, name)))
        .digest("hex")}  ${name}`,
  )
  .join("\n");
writeFileSync(join(outDir, "SHA256SUMS"), `${sums}\n`);

const mb = (readFileSync(join(outDir, bundleName)).length / 1024 / 1024).toFixed(1);
writeFileSync(
  join(outDir, "RELEASE.md"),
  `# ${appConfig.name} ${version.name} (build ${version.build}) — ${channel}

- Built: ${new Date().toISOString()}
- Commit: ${commit}
- Package: ${appConfig.bundleId}
- Upload key SHA-256: ${uploadSha}
- Firebase project: ${gs.project_info.project_id}
- API: ${appConfig.website}
- AdMob app id: ${appConfig.admob.androidAppId}${channel === "closed-test" ? " (SAMPLE — test ads)" : ""}
- Bundle: ${bundleName} (${mb} MB; users download ~15–18 MB)

Checks passed: clean tree, keystore, Firebase config, AdMob gate, npm run verify,
flutter analyze, flutter test, upload-key signature.

## Upload

${
  channel === "closed-test"
    ? "Play Console → Test and release → Testing → **Closed testing** → Create release.\n" +
      "Do NOT promote this bundle to production: it carries Google's sample AdMob ids."
    : "Play Console → Test and release → Production (or a testing track) → Create release."
}

1. Upload \`${bundleName}\`. On the first upload, accept **Play App Signing**.
${existsSync(nativeSymbols) ? "2. Play will ask for native debug symbols: upload `native-debug-symbols.zip`.\n" : ""}${
    existsSync(mapping)
      ? "3. App bundle explorer → this version → Downloads → upload `mapping.txt` as the deobfuscation file.\n"
      : ""
  }
Keep \`dart-symbols.zip\`: it is what turns a Dart stack trace from this build
back into file and line (\`flutter symbolize\`).
`,
);

console.log(`\n\x1b[32m✔ ${basename(outDir)} is ready.\x1b[0m`);
for (const name of [...files, "SHA256SUMS", "RELEASE.md"]) console.log(`    ${name}`);
console.log(`\n  ${outDir}\n`);
