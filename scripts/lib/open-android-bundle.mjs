/**
 * Installs a store bundle on a device, opens it, and says whether it survived.
 *
 * The I/O half of the check `scripts/release-android.mjs` will not file a
 * bundle without; the decision itself is `launchVerdict` in
 * `release-android.mjs` beside this file, which is what the tests pin.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchVerdict } from "./release-android.mjs";

const capture = (cmd, args) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/**
 * @param aab          the bundle to open
 * @param adb          path to adb
 * @param device       serial of the one attached device
 * @param keyProps     `key.properties`, parsed — the upload key signs the split APKs
 * @param packageName  the application id
 * @returns `{ ok: true }` or `{ ok: false, reason }`
 */
export function openBundleOnDevice({ aab, adb, device, keyProps, packageName }) {
  const shell = (...args) => capture(adb, ["-s", device, "shell", ...args]).trim();

  const probeDir = mkdtempSync(join(tmpdir(), "mealadda-release-"));
  try {
    const apks = join(probeDir, "bundle.apks");
    // The bundle, split for this device and signed with the upload key — what
    // Play does, minus Play's own signature. Not a separately built APK: that
    // would be testing a sibling of what ships.
    capture("bundletool", [
      "build-apks",
      `--bundle=${aab}`,
      `--output=${apks}`,
      "--connected-device",
      `--device-id=${device}`,
      `--adb=${adb}`,
      `--ks=${keyProps.storeFile}`,
      `--ks-key-alias=${keyProps.keyAlias}`,
      `--ks-pass=pass:${keyProps.storePassword}`,
      `--key-pass=pass:${keyProps.keyPassword}`,
    ]);
    try {
      capture("bundletool", [
        "install-apks",
        `--apks=${apks}`,
        `--device-id=${device}`,
        `--adb=${adb}`,
      ]);
    } catch (error) {
      return {
        ok: false,
        reason:
          `Could not install the bundle:\n${String(error.stderr ?? error.message).trim()}\n\n` +
          `If a copy from Play, a debug run or a newer build is installed, remove it first: ` +
          `adb uninstall ${packageName}`,
      };
    }
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }

  capture(adb, ["-s", device, "logcat", "-b", "crash", "-c"]);
  shell("am", "force-stop", packageName);
  // The activity behind the launcher icon, asked of the device rather than
  // assumed, then started the way a tap on that icon starts it.
  const launcher = shell(
    "cmd",
    "package",
    "resolve-activity",
    "--brief",
    "-c",
    "android.intent.category.LAUNCHER",
    packageName,
  )
    .split(/\r?\n/)
    .at(-1)
    .trim();
  if (!launcher.startsWith(`${packageName}/`)) {
    return { ok: false, reason: `The installed app has no launcher activity (${launcher}).` };
  }
  shell(
    "am",
    "start",
    "-a",
    "android.intent.action.MAIN",
    "-c",
    "android.intent.category.LAUNCHER",
    "-n",
    launcher,
  );
  // Long enough for the process to start, the engine to draw, and a crash on
  // the first frames to land in the log. The build 1 crash took under a second.
  execFileSync("sleep", ["15"]);

  let pid = "";
  try {
    pid = shell("pidof", packageName);
  } catch {
    // pidof exits non-zero when there is no such process.
  }
  const resumedActivity =
    /(?:topResumedActivity|mResumedActivity)[=:]\s*ActivityRecord\{\S+ \S+ (\S+)/.exec(
      shell("dumpsys", "activity", "activities"),
    )?.[1] ?? "";

  return launchVerdict({
    packageName,
    pid,
    crashLog: capture(adb, ["-s", device, "logcat", "-b", "crash", "-d"]),
    resumedActivity,
  });
}
