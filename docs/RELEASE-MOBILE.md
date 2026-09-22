# Shipping the app

TestFlight and Play internal testing. Written to be followed rather than
remembered — the parts that bite are marked.

---

## Renaming the app

App-store names must be globally unique, so finding a free one takes attempts.
Everything the name touches is generated from one file:

```bash
# edit `name` in app.config.json, then
npm run app:name
```

That rewrites the Dart constant, the TypeScript constant, the Android string
resource and the iOS `CFBundleDisplayName`. Nothing else in the repo contains
the product name as a literal, so no other file needs touching.

Changing the **bundle id** is a separate command, because it is permanent once
published and Apple refuses an upload whose id is not registered in the
developer portal:

```bash
# edit `bundleId` in app.config.json, then
npm run app:bundle-id
```

That rewrites the Android namespace and applicationId, moves the Kotlin package
directory (its path must match the package), and sets both iOS bundle
identifiers — the app's and the test target's. It then reminds you to register
the new id at developer.apple.com → Identifiers, without which the next upload
is refused.

The one thing neither command touches:

- **The store listing titles.** Those live in each console, must be unique
  across the whole store, and are usually longer than the name under the icon.
  The listing may read "MealAdda — Hostel Mess" while the icon says
  "MealAdda"; they are separate fields and only the listing has to be unique.

---

## Before the first build, once

### 1. Switch Flutter to the stable channel ⚠️

The toolchain is on **`main`**, Flutter's bleeding edge. That is fine for
building locally and wrong for producing a store artifact: breaking changes land
weekly and package compatibility churns underneath you.

```bash
flutter channel stable
flutter upgrade
cd mobile && flutter clean && flutter pub get
flutter build ios --simulator      # confirm nothing broke
flutter build apk --debug
```

Do this **before** cutting a build, not after a rejection.

### 2. Create the Android upload keystore ⚠️

```bash
keytool -genkey -v -keystore ~/mealadda-upload.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

Then `mobile/android/key.properties` (gitignored, never committed):

```properties
storeFile=/Users/<you>/mealadda-upload.jks
storePassword=<the store password>
keyAlias=upload
keyPassword=<the key password>
```

**Back the `.jks` up somewhere that is not this machine.** Play identifies an app
by its signing key. Lose it and you can never publish an update to this app
again — there is no recovery, only a new listing and every user reinstalling.

Without `key.properties` the release build falls back to debug signing so
`flutter run --release` still works. Play Console refuses a debug-signed bundle,
so that fallback cannot reach a store by accident.

### 3. Production domain ✅

`AppConfig` compiles the API base URL **into the binary**, so it must be the
permanent domain. It is `AppInfo.website` (`https://www.mealadda.in`), generated
from `website` in `app.config.json`; `tests/unit/app-identity.test.ts` fails if
it is ever a `vercel.app` host again. Verified 2026-09-19: login, `/api/me`,
`/api/student/plan` and `/api/student/menu` all answer on that origin.

### 4. Store records

- **App Store Connect** — a new app with bundle id `com.mealadda.app`.
- **Play Console** — a new app, package `com.mealadda.app`.
- The legal and help pages are ordinary routes in the web app, served at
  **mealadda.in** (`src/app/(marketing)/(legal)/`). They are public — `LEGAL_PAGES`
  in `src/lib/site.ts` feeds the proxy, footer, sitemap and robots, and
  `tests/unit/site.test.ts` fails if any of them would redirect to sign-in. The
  URLs each store asks for:

  | Field                                     | URL                                    |
  | ----------------------------------------- | -------------------------------------- |
  | Privacy Policy (both stores)              | https://www.mealadda.in/privacy        |
  | Terms of Use / EULA (App Store, optional) | https://www.mealadda.in/terms          |
  | Support URL (App Store, required)         | https://www.mealadda.in/support        |
  | Marketing URL (App Store, optional)       | https://www.mealadda.in/               |
  | Delete account URL (Play Data safety)     | https://www.mealadda.in/delete-account |

  Use the `www.` form: the bare `mealadda.in` answers with a redirect to it, and a
  store link should land directly. The old GitHub Pages copy
  (`satyam-tech04.github.io/messmanagement`) is retired and forwards here.

---

## Every build

### Bump the version

`mobile/pubspec.yaml`:

```yaml
version: 1.0.0+1
#       ^^^^^ ^
#       shown  build number — MUST increase on every upload to either store
```

Both stores reject a build number they have already seen, and it is the single
most common reason an upload fails after a long wait.

### iOS → TestFlight

```bash
cd mobile
flutter build ipa --release
```

Then open `build/ios/archive/Runner.xcarchive` in Xcode → Distribute App → App
Store Connect, or upload the `.ipa` from `build/ios/ipa/` with Transporter.

Signing is Xcode's: open `ios/Runner.xcworkspace` (**never** `.xcodeproj` — with
CocoaPods the project alone cannot see the plugin modules), select the Runner
target, Signing & Capabilities, choose your team.

`ITSAppUsesNonExemptEncryption` is already declared `false` in `Info.plist`. The
app uses only standard HTTPS, which is exempt, and declaring it stops TestFlight
asking the export-compliance question on every single upload.

### Android → internal testing

```bash
cd mobile
flutter build appbundle --release
```

Upload `build/app/outputs/bundle/release/app-release.aab`.

The `.aab` is around 50 MB because it contains every ABI and density; Play splits
it and a user downloads roughly **15–18 MB**. That is the number to quote, not
the bundle size.

---

## The forms both stores ask about

Answer these consistently with the [privacy page](https://www.mealadda.in/privacy), because a policy that claims less than
the app collects is the fastest way to fail review.

**Collected, and linked to the user:** name, phone number, email address where
present, photographs, and app activity (meals served, absences, ratings).

**Not collected:** location, contacts, browsing history, anything outside the app.

**Ads.** The app contains **no** ads SDK, analytics or tracking today — answer
"No ads" and "No tracking" (App Store: _Data Not Used to Track You_).

⚠️ **These two answers expire.** Ads are a decided part of the product, not a
maybe: **AdMob adaptive banners, on student screens only** (Slice 7). The first
build that carries the SDK has to change both stores' answers in the same
submission — ads declared, an advertising entry in Play's Data safety, and an
ATT prompt on iOS if anything is personalised. Shipping the SDK while the forms
still say "no ads" is how an account gets suspended rather than a build
rejected.

**Children.** Some messes serve students under 18. Advertising, if it ever ships, is
requested **child-directed and non-personalised for every user without
exception** — the app cannot know an individual student's age, so the strictest
setting applies to all of them. Declare this on both stores.

**Account deletion.** Built and in the app (D-32). A student opens the account menu,
taps **Delete account**, types DELETE and confirms. They are signed out on the spot,
and the mess erases them from **Account deletions** in the admin console, within 30
days. Erasure removes the name, mobile, email, room, roll number, photograph and
feedback; attendance and billing rows stay, no longer linked to a person, because
the mess's accounts depend on them.

Answer both consoles with:

- **In-app deletion:** yes. App Store Connect asks whether the app offers it — the
  answer is now yes, and the path is Account menu → Delete account.
- **Deletion URL** (Play Data safety): https://www.mealadda.in/delete-account
- **Data retained after deletion:** yes — attendance and payment records, kept for the
  mess's accounting and unlinked from the person.

Mess employees (admin and staff) cannot delete themselves from the app: their login
belongs to the mess. The same menu entry opens the web page for them, which explains
who to ask. `npm run verify:account-deletion` proves the whole path against the live
database with a disposable tenant.

**Support email.** Every page and both apps name `support@mealadda.in`
(`supportEmail` in `app.config.json`, applied by `npm run app:name`). The domain
has **no MX record yet**, so the address cannot receive mail. Set up a mailbox or
forwarding at Hostinger **before** submitting — reviewers and deletion requests
will use it.

---

## Apple review needs to get in

The app is entirely behind a login, so **a reviewer sees nothing without
credentials**. Supply a demo account in App Store Connect → App Review
Information.

Use a **seeded student in a throwaway tenant**, never Campus Crave. A reviewer
poking at a live hostel's data is not a risk worth taking, and a reviewer whose
account has no plan will see the "no plan running" screen and may read it as the
app being broken — so give them an account with a running plan and a published
menu.

`npm run create:test-accounts` provisions one ADMIN, one STAFF and one STUDENT
per tenant on a shared known password, and **refuses to touch Campus Crave** —
the refusal is in the script, not in whoever is running it. Current accounts:

| Tenant         | Role    | Login                          | Password        |
| -------------- | ------- | ------------------------------ | --------------- |
| demo-hostel    | ADMIN   | `qa.admin@demo-hostel.test`    | `MealAdda@2026` |
| demo-hostel    | STAFF   | `qa.staff@demo-hostel.test`    | `MealAdda@2026` |
| demo-hostel    | STUDENT | `9100000101` (roll QA001)      | `MealAdda@2026` |
| unversity-mess | ADMIN   | `qa.admin@unversity-mess.test` | `MealAdda@2026` |
| unversity-mess | STAFF   | `qa.staff@unversity-mess.test` | `MealAdda@2026` |
| unversity-mess | STUDENT | `9100000201` (roll QA001)      | `MealAdda@2026` |

Students sign in with the **mobile number**, not the roll number.

⚠️ **These students have no subscription**, so a QR scan returns
`NO_ACTIVE_PLAN` — exactly the "app looks broken" outcome described above. Give
the reviewer's student a running plan and a published menu before submitting.

The older seeded accounts (`admin@demo-hostel.test`, `staff@demo-hostel.test`
and the same pair on `unversity-mess`) are on **`MessOS@2026`**, not what
`scripts/seed.ts` says. The constant in that file was swept along by four
product renames while the database kept the hash from whenever the seed last
ran. Re-running `npm run db:seed` would reset them to the current constant and
invalidate anything already given to Apple.

---

## Pre-submission check — 2026-09-19

Fixed in code:

- **Account deletion** now exists end to end (D-32): in-app request, immediate
  sign-out, an admin queue at `/admin/account-deletions`, and erasure that
  anonymises instead of deleting. 18 live checks pass.
- **Force-update check** (D-33): `/api/app-version` names the oldest supported
  build and an older app shows a blocking update screen. Set `MIN_APP_BUILD` on
  Vercel the day a breaking change ships. **This could not have been added after
  release** — only code already on the phone can demand an upgrade.
- **Android backup disabled.** The session store is encrypted with a Keystore key
  that is never backed up, so a restored copy was a blob the new device could not
  read. Cloud backup and device-to-device transfer are both refused.
- **The app shows its version** under the account menu, generated from
  `pubspec.yaml` so it cannot drift from what the store shows.

- API base URL moved from `messmanagement-lime.vercel.app` to `www.mealadda.in`.
- `INTERNET` declared in the main Android manifest. It had only arrived through a
  plugin; the Flutter template puts it in the debug and profile manifests alone.
- Privacy policy, Terms, Delete account and Help & support are in the account
  menu (top-right, every role). Apple requires the privacy policy and account
  deletion to be reachable **inside** the app, not only on the listing.

Still to do by hand, blocking submission:

| #   | Item                                                                                                                                                                             | Where                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 1   | Create the upload keystore and `mobile/android/key.properties` — neither exists, so every release build is debug-signed and Play refuses it                                      | §2 above                 |
| 2   | Mailbox or forwarding for `support@mealadda.in` — `mealadda.in` still has **no MX record**                                                                                       | Hostinger                |
| 3   | Move Flutter to stable. The toolchain is `3.48.0-0.5.pre` on `main`, and `pubspec.yaml` requires Dart `^3.13.0-228.0.dev`, so the constraint must drop to whatever stable ships  | §1 above                 |
| 4   | Give the reviewer data: QA student `9100000101` has a plan only until **2026-10-12** and today's menu has **no items**. Publish menus and extend the plan past the review window | web console, demo-hostel |
| 5   | Decide iPad. `TARGETED_DEVICE_FAMILY = "1,2"`, so Apple needs 13-inch iPad screenshots and may review on an iPad. If no counter uses an iPad, set it to `1` in Xcode             | Runner target → General  |
| 6   | Register `com.mealadda.app` in the Apple developer portal (team `M7ZGXF8RPW`) and create both store records                                                                      | §4 above                 |

**iPhone only.** `TARGETED_DEVICE_FAMILY` is `1` on every configuration and the
`~ipad` orientation key is gone, so the built `Runner.app` declares
`UIDeviceFamily = (1)`. Apple therefore reviews on an iPhone and the listing
needs no 13-inch iPad screenshots. A test pins this: Xcode re-adds `2` at the
slightest provocation.

Checked and fine: targetSdk 36 / minSdk 24; iOS deployment target 15.6; camera
purpose string names the app and the reason; `ITSAppUsesNonExemptEncryption`
false; no photo-library, location or microphone permission requested; launcher
icons and splash generated; build number `1.0.0+1`.

## Known gaps at the time of writing

- **The staff screens have not been exercised on a physical device.** Scanner,
  live counts and the till compile and their rules are unit-tested, but camera →
  verify → attendance row has not been run end to end.
- **Push notifications are not built.** Slice 6, blocked on a Firebase project.
  Nothing exists yet: no Firebase config, no `firebase_messaging`, no APNs
  entitlement, no device-token table. Neither store requires push, so the first
  release can ship without it. Adding push later needs a new build that adds
  `GoogleService-Info.plist` / `google-services.json`, the Push Notifications
  capability and the APNs key in Firebase. It does not change the bundle id.
- **Advertising is built (D-35), running on Google's sample ids.** Adaptive
  banners on all four student screens, each switchable at
  `/superuser/app-config`. Before a release with ads: put the real app ids in
  `app.config.json`, run `npm run app:name`, enter the real unit ids in the
  console, add Google's `SKAdNetworkItems` list to iOS `Info.plist` (attribution
  only; test ads do not need it), serve `app-ads.txt` from mealadda.in, and run
  `npm run verify:release-ads`, which fails while sample ids remain.
- Original decision: AdMob **adaptive banners**,
  **student accounts only** — never the staff or admin screens, which are read at
  a counter during service. Slice 7, blocked on AdMob app ids. Student screens
  should be laid out so a bottom-anchored banner does not cover the meal code or
  the navigation. Ads are requested child-directed and non-personalised for
  every user without exception (see "Children" above); that constraint is not
  negotiable for revenue.
