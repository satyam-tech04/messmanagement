/**
 * The rules `scripts/release-android.mjs` applies before it lets a bundle out.
 *
 * The script itself shells out to Flutter, Gradle and keytool; what is worth
 * pinning is the decisions it makes — which build number it reads, whether
 * sample ad ids are allowed through, and whether the bundle was signed by the
 * upload key rather than the debug key Gradle silently falls back to.
 */
import { describe, expect, it } from "vitest";
import {
  extractSha256,
  isSampleAdMobId,
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
