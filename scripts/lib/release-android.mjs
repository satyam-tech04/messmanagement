/**
 * The decisions `scripts/release-android.mjs` makes, kept free of I/O so they
 * can be tested (`tests/unit/release-android.test.ts`).
 */

/** Google's public demo AdMob publisher. Anything under it serves test ads. */
const SAMPLE_PUBLISHER = "ca-app-pub-3940256099942544";

/** Parses a Java `.properties` file of the simple kind `key.properties` is. */
export function parseProperties(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

/**
 * `version: 1.0.0+1` → `{ name: "1.0.0", build: 1 }`. The build number becomes
 * Android's versionCode, and Play rejects any it has already seen.
 */
export function parsePubspecVersion(pubspec) {
  const match = pubspec.match(/^version:\s*(\S+)\s*$/m);
  if (!match) throw new Error("pubspec.yaml has no version line");
  const [name, build] = match[1].split("+");
  if (!build || !/^\d+$/.test(build)) {
    throw new Error(`pubspec version "${match[1]}" has no build number (expected e.g. 1.0.0+1)`);
  }
  return { name, build: Number(build) };
}

export function isSampleAdMobId(id) {
  return id.startsWith(SAMPLE_PUBLISHER);
}

/**
 * Which track a bundle is fit for. Sample ad ids earn nothing, so a build that
 * carries them is closed-test only, and only when asked for explicitly.
 */
export function releaseChannel({ androidAdMobId, allowSampleAds }) {
  if (!isSampleAdMobId(androidAdMobId)) return { ok: true, channel: "production" };
  if (allowSampleAds) return { ok: true, channel: "closed-test" };
  return {
    ok: false,
    reason:
      "app.config.json carries Google's SAMPLE AdMob app id. Put the real id in and run " +
      "`npm run app:name`, or pass --allow-sample-ads for a closed-test-only build.",
  };
}

export function releaseName(version, channel) {
  return `${version.name}+${version.build}-${channel}`;
}

/** The SHA-256 certificate fingerprint from `keytool` output, or null. */
export function extractSha256(keytoolOutput) {
  const match = keytoolOutput.match(/SHA-?256\)?:\s*([0-9A-Fa-f:]+)/);
  return match ? match[1].toUpperCase() : null;
}
