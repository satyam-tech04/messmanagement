/**
 * What the app is told to do at launch.
 *
 * This is the switch panel for software on other people's phones, so the tests
 * are about what happens when it is set wrong or cannot be read at all: the
 * answer must always be a working app, and — for ads specifically — no ads
 * rather than ads in the wrong place. A missing ad costs a fraction of a rupee;
 * an ad where it should not be risks the whole AdMob account.
 */
import { describe, expect, it } from "vitest";
import {
  AD_PLACEMENTS,
  GOOGLE_TEST_UNITS,
  adsFor,
  defaultAppConfig,
  parsePlacements,
  resolveMinimumBuild,
} from "@/core/policies/app-config.policy";

const configured = {
  adsEnabled: true,
  adsTestMode: false,
  placements: { qr: false, menu: true, plan: true, more: true },
  unitAndroid: "ca-app-pub-1111111111111111/2222222222",
  unitIos: "ca-app-pub-1111111111111111/3333333333",
};

describe("whether a screen carries a banner", () => {
  it("serves the placements that are switched on", () => {
    const ads = adsFor(configured, "ANDROID");
    expect(ads.enabled).toBe(true);
    expect(ads.placements).toEqual({ qr: false, menu: true, plan: true, more: true });
  });

  it("gives each platform its own unit", () => {
    expect(adsFor(configured, "ANDROID").unitId).toBe(configured.unitAndroid);
    expect(adsFor(configured, "IOS").unitId).toBe(configured.unitIos);
  });

  it("shows nothing anywhere when ads are switched off", () => {
    const ads = adsFor({ ...configured, adsEnabled: false }, "ANDROID");
    expect(ads.enabled).toBe(false);
    // Not just the flag: the placements come back empty too, so an app that
    // reads them carelessly still shows nothing.
    expect(Object.values(ads.placements).every((on) => !on)).toBe(true);
  });

  it("shows nothing on a platform with no unit configured", () => {
    // Half-configured is the normal state while setting AdMob up. Serving the
    // other platform's unit would be worse than serving none.
    const ads = adsFor({ ...configured, unitIos: null }, "IOS");
    expect(ads.enabled).toBe(false);
    expect(ads.unitId).toBeNull();
  });

  it("refuses a unit id that is really an app id", () => {
    // `ca-app-pub-…~…` is the app id and `…/…` the unit id. Pasting the first
    // into the second is the commonest AdMob mistake, and it fails silently:
    // no ads, no error, nothing in any log.
    const ads = adsFor(
      { ...configured, unitAndroid: "ca-app-pub-1111111111111111~2222222222" },
      "ANDROID",
    );
    expect(ads.enabled).toBe(false);
  });
});

describe("test mode", () => {
  it("serves Google's test units instead of the real ones", () => {
    // A real unit hit during development is invalid traffic, and enough of it
    // suspends an AdMob account rather than warning it.
    const ads = adsFor({ ...configured, adsTestMode: true }, "ANDROID");
    expect(ads.unitId).toBe(GOOGLE_TEST_UNITS.ANDROID);
    expect(ads.testMode).toBe(true);
  });

  it("works even before any real unit has been entered", () => {
    // So ads can be seen working end to end before AdMob has approved anything.
    const ads = adsFor(
      { ...configured, adsTestMode: true, unitAndroid: null, unitIos: null },
      "IOS",
    );
    expect(ads.enabled).toBe(true);
    expect(ads.unitId).toBe(GOOGLE_TEST_UNITS.IOS);
  });
});

describe("placements that arrive malformed", () => {
  it("keeps only the screens the app actually has", () => {
    // The column is jsonb, so anything could be in it — including a key from a
    // screen that was renamed two releases ago.
    const parsed = parsePlacements({ menu: true, somewhere_else: true });
    expect(Object.keys(parsed).sort()).toEqual([...AD_PLACEMENTS].sort());
    expect(parsed.menu).toBe(true);
  });

  it("treats anything that is not `true` as off", () => {
    const parsed = parsePlacements({ menu: "yes", plan: 1, more: null, qr: true });
    expect(parsed.menu).toBe(false);
    expect(parsed.plan).toBe(false);
    expect(parsed.more).toBe(false);
    expect(parsed.qr).toBe(true);
  });

  it("survives a null or a string where an object was expected", () => {
    for (const rubbish of [null, undefined, "on", 42, []]) {
      const parsed = parsePlacements(rubbish);
      expect(Object.values(parsed).every((on) => !on)).toBe(true);
    }
  });
});

describe("when the config cannot be read at all", () => {
  it("leaves a working app with no ads and nobody blocked", () => {
    // The default is what a student gets when the database is unreachable. It
    // has to be the safe answer on both counts at once.
    const fallback = defaultAppConfig();
    expect(fallback.ads.enabled).toBe(false);
    expect(fallback.minimumBuild).toBe(0);
  });
});

describe("the minimum build", () => {
  it("prefers the value an operator can change without a deploy", () => {
    expect(resolveMinimumBuild({ stored: 12, envFallback: 3 })).toBe(12);
  });

  it("falls back to the environment when the row says nothing", () => {
    expect(resolveMinimumBuild({ stored: null, envFallback: 3 })).toBe(3);
  });

  it("never blocks anyone on a nonsense value", () => {
    // A negative or absurd number here locks every student out of their meals
    // at once, with no way in but a deploy.
    for (const stored of [-1, Number.NaN, 10_000_000]) {
      expect(resolveMinimumBuild({ stored, envFallback: 0 })).toBe(0);
    }
  });
});
