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

/**
 * Serials from `adb devices` that are ready to take commands. A phone that is
 * `unauthorized` or `offline` is left out: it is attached, and useless.
 */
export function connectedDevices(adbDevicesOutput) {
  return adbDevicesOutput
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === "device")
    .map(([serial]) => serial);
}

/**
 * Whether the installed bundle survived being opened.
 *
 * Three things must all hold a few seconds after launch: the process exists,
 * the crash log has nothing from our package, and our activity is the one on
 * screen. The crash log is checked even when the process is alive, because
 * Android restarts a crashed app and a live pid would hide it.
 *
 * `crashLog` is `adb logcat -b crash`, cleared before the launch. It carries
 * Java crashes ("Process: <package>") and native ones ("Cmdline: <package>").
 */
export function launchVerdict({ packageName, pid, crashLog, resumedActivity }) {
  const ours = new RegExp(`(Process|Cmdline): ${packageName.replace(/\./g, "\\.")}\\b`);
  if (ours.test(crashLog)) {
    const lines = crashLog.split(/\r?\n/).filter((line) => line.trim());
    // The innermost cause is the one that says what broke; the outer frames
    // only say that something did.
    const cause = (lines.filter((line) => line.includes("Caused by:")).at(-1) ?? lines[0])
      .replace(/^.*(?:Caused by:|AndroidRuntime:|DEBUG\s*:)\s*/, "")
      .trim();
    return { ok: false, reason: `The app crashed on open: ${cause}` };
  }
  if (!pid.trim()) {
    return { ok: false, reason: "The app is not running a few seconds after launch." };
  }
  if (!resumedActivity.startsWith(`${packageName}/`)) {
    return {
      ok: false,
      reason: `The app is not in the foreground after launch (showing ${resumedActivity || "nothing"}).`,
    };
  }
  return { ok: true };
}
