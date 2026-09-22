/**
 * The product's name and bundle id, asserted everywhere they must be literals.
 *
 * App-store names must be globally unique, so settling on one took four
 * attempts — MessOS, CampusMeals, MessMate, MealAdda. Each rename ran
 * `scripts/apply-app-identity.mjs`, and each time the script rewrote only the
 * places it happened to know about. `CFBundleName` and `NSCameraUsageDescription`
 * were not among them, so a dead brand survived in the archive Xcode displays
 * and in the camera permission sheet a student reads out loud — the one place
 * the wrong name is quoted back at the user by iOS itself, and a string Apple
 * reviews.
 *
 * A grep finds that only if you think to grep for a name you have already
 * stopped using. This asserts the invariant instead: **every place that carries
 * the identity agrees with `app.config.json`.** A newly-forgotten place fails
 * here on the next rename, without anyone having to remember the old brand.
 *
 * Deliberately not covered: `SUPER_USER_EMAIL` and the synthetic email suffix in
 * `src/core/domain/identity.ts`. Those are frozen — 82 students' Supabase Auth
 * addresses derive from them — and `tests/unit/identity.test.ts` pins them to
 * their literal values precisely so a rename can never reach them.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LEGAL_PAGES } from "@/lib/site";

const root = join(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const config = JSON.parse(read("app.config.json")) as {
  name: string;
  bundleId: string;
  supportEmail: string;
  website: string;
};
const { name, bundleId, supportEmail, website } = config;

/** `com.mealadda.app` → `mealadda`, the Dart and npm package name. */
const packageName = bundleId.split(".").at(-2)!;

/** The value of a `<key>`'s following `<string>` in an Info.plist. */
function plistString(key: string): string | undefined {
  const plist = read("mobile/ios/Runner/Info.plist");
  return new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(plist)?.[1];
}

describe("app.config.json is the only source of the product name", () => {
  it("names a bundle id that both stores will accept", () => {
    // Reverse-DNS, lowercase. Apple and Google both refuse anything else, and
    // it is permanent once published.
    expect(bundleId).toMatch(/^[a-z0-9]+(\.[a-z0-9]+)+$/);
  });

  it("keeps the name short enough for CFBundleName", () => {
    // iOS truncates past 15 characters rather than erroring.
    expect(name.length).toBeLessThanOrEqual(15);
  });

  it("names a permanent https origin for the website", () => {
    // The app compiles this into the binary. A Vercel-generated host would
    // strand every installed copy the day the project is renamed.
    expect(website).toMatch(/^https:\/\/[a-z0-9.-]+$/);
    expect(website).not.toMatch(/vercel\.app/);
  });

  it("keeps the name safe for XML and a plist", () => {
    expect(name).not.toMatch(/["'<>&]/);
  });
});

describe("generated constants", () => {
  it("carries the name and support address into TypeScript", () => {
    const ts = read("src/lib/app-info.ts");
    expect(ts).toContain(`export const APP_NAME = ${JSON.stringify(name)};`);
    expect(ts).toContain(`export const SUPPORT_EMAIL = ${JSON.stringify(supportEmail)};`);
    expect(ts).toContain(`export const WEBSITE = ${JSON.stringify(website)};`);
  });

  it("carries the name and support address into Dart", () => {
    const dart = read("mobile/lib/src/core/app_info.dart");
    expect(dart).toContain(`static const String name = ${JSON.stringify(name)};`);
    expect(dart).toContain(`static const String supportEmail = ${JSON.stringify(supportEmail)};`);
    expect(dart).toContain(`static const String website = ${JSON.stringify(website)};`);
  });

  it("points the app's production API at the website, not a Vercel host", () => {
    // Changing this after release needs a store update every student must
    // install before their app works again.
    const dart = read("mobile/lib/src/core/config.dart");
    expect(dart).toMatch(/static const String _productionBaseUrl\s*=\s*AppInfo\.website;/);
  });

  it("links every public legal page from inside the app", () => {
    // Apple requires the privacy policy and account deletion to be reachable
    // in the app itself, not only from the store listing. The paths are the
    // web's LEGAL_PAGES, so a page cannot be renamed on one side only.
    const dart = read("mobile/lib/src/core/legal_links.dart");
    for (const { href } of LEGAL_PAGES) {
      expect(dart).toContain(`'${href}'`);
    }
  });
});

describe("Android", () => {
  it("labels the launcher with the name", () => {
    expect(read("mobile/android/app/src/main/res/values/strings.xml")).toContain(
      `<string name="app_name">${name}</string>`,
    );
  });

  it("carries a Firebase config for THIS app, if it carries one at all", () => {
    // The file is optional (push is off until it exists), but a wrong one is
    // worse than none: Gradle applies it happily, the app builds, and every
    // notification goes to a project that has never heard of these students.
    // Easy to do — a `google-services.json` for another app is one Downloads
    // folder away, and the file does not say which app it is for anywhere a
    // human would look.
    const path = "mobile/android/app/google-services.json";
    if (!existsSync(join(root, path))) return;

    const config = JSON.parse(read(path)) as {
      client: Array<{ client_info: { android_client_info: { package_name: string } } }>;
    };
    const packages = config.client.map((c) => c.client_info.android_client_info.package_name);
    expect(packages).toContain(bundleId);
  });

  it("declares INTERNET in the release manifest itself", () => {
    // Flutter's template puts it only in the debug and profile manifests.
    // A release build then reaches the network only while some plugin happens
    // to declare it — drop that plugin and the store build goes silently offline.
    expect(read("mobile/android/app/src/main/AndroidManifest.xml")).toContain(
      '<uses-permission android:name="android.permission.INTERNET" />',
    );
  });

  it("builds under the configured application id", () => {
    const gradle = read("mobile/android/app/build.gradle.kts");
    expect(gradle).toContain(`namespace = "${bundleId}"`);
    expect(gradle).toContain(`applicationId = "${bundleId}"`);
  });

  it("declares MainActivity in the matching Kotlin package", () => {
    // Kotlin's package has to agree with the directory, so a rename moves the
    // file. Reading it by its expected path proves the move happened.
    const activity = read(
      `mobile/android/app/src/main/kotlin/${bundleId.split(".").join("/")}/MainActivity.kt`,
    );
    expect(activity).toContain(`package ${bundleId}`);
  });
});

describe("iOS", () => {
  it("shows the name under the icon", () => {
    expect(plistString("CFBundleDisplayName")).toBe(name);
  });

  it("shows the name in the archive and as the short-name fallback", () => {
    // The key that showed `campusmeals` in Xcode's organiser long after the
    // display name had moved on.
    expect(plistString("CFBundleName")).toBe(name);
  });

  it("names the current app in the camera permission sheet", () => {
    // iOS quotes this string to the student verbatim, and Apple reviews it.
    const purpose = plistString("NSCameraUsageDescription");
    expect(purpose).toContain(name);
    // A purpose string that does not say why is a review rejection.
    expect(purpose).toMatch(/camera/i);
  });

  it("ships for iPhone only", () => {
    // `1` is iPhone, `2` is iPad. Declaring iPad means Apple reviews the app on
    // one and the listing needs 13-inch screenshots — for a scanner and a meal
    // code nobody holds a tablet for. Xcode re-adds `2` at the slightest
    // provocation, so it is asserted rather than remembered.
    const pbx = read("mobile/ios/Runner.xcodeproj/project.pbxproj");
    const families = [...pbx.matchAll(/TARGETED_DEVICE_FAMILY = "?([^;"]+)"?;/g)].map((m) =>
      m[1]!.trim(),
    );
    expect(families.length).toBeGreaterThan(0);
    for (const family of families) {
      expect(family).toBe("1");
    }
  });

  it("builds both targets under the configured bundle id", () => {
    const pbx = read("mobile/ios/Runner.xcodeproj/project.pbxproj");
    const ids = [...pbx.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].map((m) => m[1]!.trim());
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect([bundleId, `${bundleId}.RunnerTests`]).toContain(id);
    }
  });
});

describe("package metadata", () => {
  it("names the Dart package after the bundle id", () => {
    expect(read("mobile/pubspec.yaml")).toMatch(new RegExp(`^name: ${packageName}$`, "m"));
  });

  it("carries pubspec's version into Dart, so the app can show it", () => {
    // The generated constant is only right until somebody bumps the version and
    // forgets to re-run the script. This is what catches that, on the commit
    // that bumped it — the build number is also what the force-update check
    // compares, so a stale one would block the wrong releases.
    const pubspec = read("mobile/pubspec.yaml");
    const version = /^version:\s*(\d+\.\d+\.\d+)\+(\d+)\s*$/m.exec(pubspec);
    expect(version, "pubspec.yaml needs `version: x.y.z+n`").not.toBeNull();

    const dart = read("mobile/lib/src/core/app_info.dart");
    expect(dart).toContain(`static const String version = ${JSON.stringify(version![1])};`);
    expect(dart).toContain(`static const int build = ${version![2]};`);
  });

  it("describes the Flutter package with the current name", () => {
    const description = /^description: "(.*)"$/m.exec(read("mobile/pubspec.yaml"))?.[1];
    expect(description).toContain(name);
  });

  it("names the npm package after the bundle id", () => {
    expect(JSON.parse(read("package.json")).name).toBe(packageName);
  });
});

describe("no dead brand survives", () => {
  // Every name this product has been called. Kept as history precisely so a
  // reappearance is caught: `CampusMeals` was still in the plist two renames
  // after it was abandoned.
  const retired = ["MessOS", "CampusMeals", "MessMate", "MealAdda"].filter(
    (brand) => brand !== name,
  );

  const carriers = [
    "app.config.json",
    "src/lib/app-info.ts",
    "mobile/lib/src/core/app_info.dart",
    "mobile/android/app/src/main/res/values/strings.xml",
    "mobile/android/app/build.gradle.kts",
    "mobile/ios/Runner/Info.plist",
    "mobile/pubspec.yaml",
    "package.json",
  ];

  it.each(carriers)("%s names only the current product", (path) => {
    const contents = read(path).toLowerCase();
    for (const brand of retired) {
      expect(contents).not.toContain(brand.toLowerCase());
    }
  });
});
