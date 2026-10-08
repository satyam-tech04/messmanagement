/**
 * The rules `scripts/release-android.mjs` applies before it lets a bundle out.
 *
 * The script itself shells out to Flutter, Gradle and keytool; what is worth
 * pinning is the decisions it makes — which build number it reads, whether
 * sample ad ids are allowed through, and whether the bundle was signed by the
 * upload key rather than the debug key Gradle silently falls back to — and
 * whether the bundle, installed on a real device, actually stayed open.
 */
import { describe, expect, it } from "vitest";
import {
  connectedDevices,
  extractSha256,
  isSampleAdMobId,
  launchVerdict,
  parsePubspecVersion,
  parseProperties,
  releaseChannel,
  releaseName,
} from "../../scripts/lib/release-android.mjs";

describe("parseProperties", () => {
  it("reads key=value lines, ignoring comments and blanks", () => {
    const text = "# upload key\nstoreFile=/Users/x/k.jks\n\nkeyAlias = upload\nstorePassword=a=b\n";
    expect(parseProperties(text)).toEqual({
      storeFile: "/Users/x/k.jks",
      keyAlias: "upload",
      storePassword: "a=b",
    });
  });
});

describe("parsePubspecVersion", () => {
  it("splits the shown version from the build number", () => {
    expect(parsePubspecVersion("name: messos\nversion: 1.2.3+45\n")).toEqual({
      name: "1.2.3",
      build: 45,
    });
  });

  it("refuses a version without a build number, which Play cannot order", () => {
    expect(() => parsePubspecVersion("version: 1.0.0\n")).toThrow(/build number/);
  });

  it("refuses a pubspec with no version at all", () => {
    expect(() => parsePubspecVersion("name: messos\n")).toThrow(/version/);
  });
});

describe("isSampleAdMobId", () => {
  it("recognises Google's public demo publisher", () => {
    expect(isSampleAdMobId("ca-app-pub-3940256099942544~3347511713")).toBe(true);
  });

  it("accepts a real publisher id", () => {
    expect(isSampleAdMobId("ca-app-pub-1234567890123456~1234567890")).toBe(false);
  });
});

describe("releaseChannel", () => {
  const real = "ca-app-pub-1234567890123456~1234567890";
  const sample = "ca-app-pub-3940256099942544~3347511713";

  it("is a production build when the ad id is real", () => {
    expect(releaseChannel({ androidAdMobId: real, allowSampleAds: false })).toEqual({
      ok: true,
      channel: "production",
    });
  });

  it("refuses sample ids unless explicitly allowed", () => {
    const result = releaseChannel({ androidAdMobId: sample, allowSampleAds: false });
    expect(result.ok).toBe(false);
  });

  it("labels an allowed sample-id build as closed-test only", () => {
    expect(releaseChannel({ androidAdMobId: sample, allowSampleAds: true })).toEqual({
      ok: true,
      channel: "closed-test",
    });
  });

  it("never calls a sample-id build production, even with real ids elsewhere", () => {
    expect(releaseChannel({ androidAdMobId: sample, allowSampleAds: true }).channel).not.toBe(
      "production",
    );
  });
});

describe("releaseName", () => {
  it("names the folder by version, build and channel", () => {
    expect(releaseName({ name: "1.0.0", build: 1 }, "closed-test")).toBe("1.0.0+1-closed-test");
    expect(releaseName({ name: "1.0.0", build: 2 }, "production")).toBe("1.0.0+2-production");
  });
});

describe("extractSha256", () => {
  it("reads the SHA-256 line keytool prints, normalised", () => {
    const out = "Owner: CN=MealAdda\n\t SHA1: AA:BB\n\t SHA256: 9c:6f:D4:89\nSignature algorithm";
    expect(extractSha256(out)).toBe("9C:6F:D4:89");
  });

  it("accepts the 'SHA-256' spelling some keytool versions use", () => {
    expect(extractSha256("Certificate fingerprint (SHA-256): 01:AB")).toBe("01:AB");
  });

  it("returns null when there is no fingerprint, e.g. an unsigned bundle", () => {
    expect(extractSha256("jar is unsigned.")).toBeNull();
  });
});

describe("connectedDevices", () => {
  it("lists devices that are ready", () => {
    const out = "List of devices attached\nemulator-5554\tdevice\nR58M12ABCDE\tdevice\n\n";
    expect(connectedDevices(out)).toEqual(["emulator-5554", "R58M12ABCDE"]);
  });

  it("leaves out a phone that has not authorised this computer, or is offline", () => {
    // Either would make every later adb command fail with something unreadable.
    const out = "List of devices attached\nR58M12ABCDE\tunauthorized\nemulator-5554\toffline\n";
    expect(connectedDevices(out)).toEqual([]);
  });

  it("is empty when nothing is plugged in", () => {
    expect(connectedDevices("List of devices attached\n\n")).toEqual([]);
    expect(connectedDevices("* daemon started successfully\nList of devices attached\n")).toEqual(
      [],
    );
  });
});

describe("launchVerdict", () => {
  // Build 1.0.0+1 passed every other check in the script and died on open on
  // students' phones: R8 had stripped a constructor that only a shrunk release
  // build is missing. This is the check that would have stopped it.
  const pkg = "com.mealadda.app";
  const up = {
    packageName: pkg,
    pid: "6156",
    crashLog: "",
    resumedActivity: `${pkg}/.MainActivity`,
  };

  it("passes a build that is running, in front, and logged no crash", () => {
    expect(launchVerdict(up)).toEqual({ ok: true });
  });

  it("fails a build whose process is gone", () => {
    const verdict = launchVerdict({ ...up, pid: "" });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/not running/);
  });

  it("fails on a fatal exception in our process, and quotes it", () => {
    const crashLog = [
      "E AndroidRuntime: FATAL EXCEPTION: main",
      `E AndroidRuntime: Process: ${pkg}, PID: 4461`,
      "E AndroidRuntime: java.lang.RuntimeException: Unable to get provider androidx.startup.InitializationProvider",
      "E AndroidRuntime: Caused by: java.lang.RuntimeException: Failed to create an instance of androidx.work.impl.WorkDatabase",
    ].join("\n");
    // Still "running" because Android restarted it — the crash is what counts.
    const verdict = launchVerdict({ ...up, crashLog });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe(
      "The app crashed on open: java.lang.RuntimeException: Failed to create an instance of androidx.work.impl.WorkDatabase",
    );
  });

  it("fails on a native crash in our process", () => {
    const crashLog = `F DEBUG   : Cmdline: ${pkg}\nF DEBUG   : signal 11 (SIGSEGV), code 1`;
    expect(launchVerdict({ ...up, crashLog }).ok).toBe(false);
  });

  it("ignores some other app crashing on the same device", () => {
    const crashLog =
      "E AndroidRuntime: FATAL EXCEPTION: main\nE AndroidRuntime: Process: com.example.other, PID: 9";
    expect(launchVerdict({ ...up, crashLog })).toEqual({ ok: true });
  });

  it("fails when the app is alive but not what is on screen", () => {
    // Fell back to the launcher: the activity finished or never came up.
    const verdict = launchVerdict({
      ...up,
      resumedActivity: "com.google.android.apps.nexuslauncher/.NexusLauncherActivity",
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/not in the foreground/);
  });
});
