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

### 3. Decide the production domain ⚠️

`AppConfig` compiles the API base URL **into the binary**. It currently points at
`https://messmanagement-lime.vercel.app`, a Vercel-generated name derived from
the project name.

Fine for TestFlight. **Not fine for a public release**: once students install,
changing that string needs a store update every one of them has to receive
before their app works again. Buy a domain, point production at it, change the
one constant in `mobile/lib/src/core/config.dart`.

### 4. Store records

- **App Store Connect** — a new app with bundle id `com.mealadda.app`.
- **Play Console** — a new app, package `com.mealadda.app`.
- Privacy policy URL: `https://<domain>/privacy` (the page is public and needs
  no sign-in — `proxy.ts` allows it explicitly, which is what a reviewer needs).

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

Answer these consistently with `/privacy`, because a policy that claims less than
the app collects is the fastest way to fail review.

**Collected, and linked to the user:** name, phone number, email address where
present, photographs, and app activity (meals served, absences, ratings).

**Not collected:** location, contacts, browsing history, anything outside the app.

**Children.** Some messes serve students under 18. Advertising, when it ships, is
requested **child-directed and non-personalised for every user without
exception** — the app cannot know an individual student's age, so the strictest
setting applies to all of them. Declare this on both stores.

**Account deletion.** Play requires a route to it. Mess administrators can delete
a student from the admin console; the privacy page says so and gives a contact
address for anyone whose mess will not act.

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

## Known gaps at the time of writing

- **The staff screens have not been exercised on a physical device.** Scanner,
  live counts and the till compile and their rules are unit-tested, but camera →
  verify → attendance row has not been run end to end.
- **Push notifications are not built.** Slice 6, blocked on a Firebase project.
- **Advertising is not built.** Slice 7, blocked on AdMob app ids.
