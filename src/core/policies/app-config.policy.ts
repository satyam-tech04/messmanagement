/**
 * Runtime configuration for the app (D-35).
 *
 * The rule behind this file: **a store release should be rare.** Anything that
 * might plausibly need changing is decided here, from a row an operator can
 * edit, rather than compiled into a binary that some students will never
 * update.
 *
 * Two things only are compiled in, because the operating system reads them
 * before any of our code runs: the AdMob **app id** (Android manifest, iOS
 * Info.plist) and the API base URL. Everything else about ads — whether they
 * run, which screens carry them, which unit, test or live — is decided here.
 *
 * **Ads fail closed.** Unreadable or half-configured means no ads. A missing ad
 * costs a fraction of a rupee; an ad in the wrong place, or a real unit hit by
 * a developer, risks the AdMob account the revenue depends on.
 *
 * Pure: no I/O, no framework.
 */

/** The student screens that can carry a banner, by the app's own route names. */
export const AD_PLACEMENTS = ["qr", "menu", "plan", "more"] as const;

export type AdPlacement = (typeof AD_PLACEMENTS)[number];

export type Placements = Record<AdPlacement, boolean>;

export type DevicePlatform = "ANDROID" | "IOS";

/**
 * Google's public test ad units.
 *
 * Documented and stable, and the only ids that may be used while developing: a
 * real unit hit by a developer is invalid traffic, and enough of it gets an
 * account suspended rather than warned.
 */
export const GOOGLE_TEST_UNITS: Record<DevicePlatform, string> = {
  ANDROID: "ca-app-pub-3940256099942544/9214589741",
  IOS: "ca-app-pub-3940256099942544/2435281174",
};

/**
 * A live ad unit id: `ca-app-pub-<publisher>/<unit>`.
 *
 * The slash matters. `ca-app-pub-…~…` is the *app* id, and pasting it here is
 * the commonest AdMob mistake there is — it produces no ads, no error and
 * nothing in any log, so it is rejected rather than forwarded.
 */
const AD_UNIT_PATTERN = /^ca-app-pub-\d+\/\d+$/;

export interface StoredAdConfig {
  readonly adsEnabled: boolean;
  readonly adsTestMode: boolean;
  readonly placements: unknown;
  readonly unitAndroid: string | null;
  readonly unitIos: string | null;
}

export interface ResolvedAds {
  readonly enabled: boolean;
  readonly testMode: boolean;
  readonly unitId: string | null;
  readonly placements: Placements;
}

const NO_PLACEMENTS: Placements = { qr: false, menu: false, plan: false, more: false };

/**
 * Narrows whatever is in the jsonb column to the screens this app actually has.
 *
 * Unknown keys are dropped rather than passed through: a placement for a screen
 * that was renamed two releases ago should not reach a client that would then
 * have to decide what to do with it. Anything that is not exactly `true` is
 * off, so a string, a number or a null cannot switch an ad on by being truthy.
 */
export function parsePlacements(raw: unknown): Placements {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ...NO_PLACEMENTS };

  const source = raw as Record<string, unknown>;
  const placements = { ...NO_PLACEMENTS };
  for (const key of AD_PLACEMENTS) placements[key] = source[key] === true;

  return placements;
}

/** What this platform should do about ads, all-or-nothing. */
export function adsFor(config: StoredAdConfig, platform: DevicePlatform): ResolvedAds {
  const off: ResolvedAds = {
    enabled: false,
    testMode: config.adsTestMode,
    unitId: null,
    placements: { ...NO_PLACEMENTS },
  };

  if (!config.adsEnabled) return off;

  // Test mode ignores the configured units entirely, so ads can be seen working
  // end to end before AdMob has approved anything.
  if (config.adsTestMode) {
    return {
      enabled: true,
      testMode: true,
      unitId: GOOGLE_TEST_UNITS[platform],
      placements: parsePlacements(config.placements),
    };
  }

  const unitId = platform === "ANDROID" ? config.unitAndroid : config.unitIos;

  // Half-configured is the normal state while setting AdMob up, and serving the
  // other platform's unit would be worse than serving none.
  if (!unitId || !AD_UNIT_PATTERN.test(unitId)) return off;

  return {
    enabled: true,
    testMode: false,
    unitId,
    placements: parsePlacements(config.placements),
  };
}

/**
 * The oldest build still allowed to run.
 *
 * Prefers the stored value, because raising it is exactly the thing nobody
 * wants to wait for a deploy to do. A nonsense value blocks nobody: this number
 * can lock every student out of their meals at once, and the only way back in
 * would be the deploy this exists to avoid.
 */
export function resolveMinimumBuild(input: {
  readonly stored: number | null;
  readonly envFallback: number;
}): number {
  const { stored, envFallback } = input;

  if (stored === null || !Number.isFinite(stored) || stored < 0) return envFallback;
  // Far beyond any build number this app will reach in its lifetime, so it is a
  // typo rather than an intention.
  if (stored > 1_000_000) return envFallback;

  return stored;
}

export interface AppConfig {
  readonly minimumBuild: number;
  readonly ads: ResolvedAds;
  readonly flags: Record<string, unknown>;
}

/**
 * What the app is told when the config cannot be read.
 *
 * Has to be safe on both counts at once: nobody blocked from their meals, and
 * no ads shown anywhere.
 */
export function defaultAppConfig(): AppConfig {
  return {
    minimumBuild: 0,
    ads: { enabled: false, testMode: true, unitId: null, placements: { ...NO_PLACEMENTS } },
    flags: {},
  };
}
