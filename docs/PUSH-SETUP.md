# Switching push notifications on

Everything in the code is built and dormant (D-34). Nothing here changes any
behaviour until the three credentials below exist; until then the app runs
normally with notifications off, and the admin console says so on its own
Notifications screen.

Three things are needed, in this order:

| #   | What                          | Where it comes from         | Where it goes                                                                        |
| --- | ----------------------------- | --------------------------- | ------------------------------------------------------------------------------------ |
| 1   | ✅ `google-services.json`     | Firebase → Android app      | `mobile/android/app/google-services.json` — **done**, project `mealadda-49d4f`       |
| 2   | ✅ `GoogleService-Info.plist` | Firebase → iOS app          | `mobile/ios/Runner/` + Xcode target — **done**, verified inside `Runner.app`         |
| 3   | ✅ Service account JSON       | Firebase → Service accounts | `FIREBASE_SERVICE_ACCOUNT_JSON` in `.env` — **done locally**, still needed on Vercel |

Plus one from Apple: an **APNs key** (`.p8`) uploaded into Firebase, without
which iOS notifications silently never arrive. ✅ **Done** — key `S9M55H4RD5`,
team `M7ZGXF8RPW`, uploaded 21 Sep 2026 for both Development and Production.
The file lives in `~/Documents/MealAdda/credentials/`, outside this repo.

FCM costs nothing. The Spark (free) plan sends unlimited notifications and no
card is required.

---

## ⚠️ Which of these are secret

- **`google-services.json` and `GoogleService-Info.plist` are not secrets.**
  They ship inside the app binary, and anyone can unzip an APK and read them.
  Commit them.
- **The service account JSON is a real secret.** It can send notifications to
  every student as you, forever. Save it **outside this repo**, like the upload
  keystore, and paste it only into `.env` and the Vercel dashboard — never into
  a chat, a commit or a screenshot.
- **The APNs `.p8` downloads exactly once.** Apple will not give it again. Back
  it up beside the keystore.

---

## 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and sign in with the Google
   account that should own this long-term — moving a project between accounts
   later is possible but tedious.
2. **Add project** → name it `MealAdda` → Continue.
3. **Turn Google Analytics off.** It is not needed for notifications, and
   enabling it adds a data-collection SDK that both stores' privacy forms would
   then have to declare — which contradicts the "no analytics, no tracking"
   answers already given in [RELEASE-MOBILE.md](RELEASE-MOBILE.md).
4. Create project, and wait for it to finish.

---

## 2. Android app → `google-services.json`

1. In the project, **Add app → Android**.
2. **Android package name:** `com.mealadda.app` — exactly this. It must match
   `bundleId` in `app.config.json` or Firebase rejects every message.
3. Nickname: `MealAdda Android`. **Leave the SHA-1 field empty** — it is only
   needed for Google Sign-In and Dynamic Links, neither of which this app uses.
4. **Register app** → **Download `google-services.json`**.
5. Put it at exactly:

   ```
   mobile/android/app/google-services.json
   ```

✅ **Done, 21 Sep 2026.** The file in place is for project `mealadda-49d4f`,
package `com.mealadda.app`. `tests/unit/app-identity.test.ts` now fails if a
config for a different app is ever dropped in — which is a live risk, since a
`google-services.json` for another project looks identical from the outside.

6. Skip the rest of Firebase's wizard ("Add the SDK", "Next", "Continue to
   console"). The Gradle wiring is already in the repo and applies itself the
   moment that file exists.

---

## 3. iOS app → `GoogleService-Info.plist`

1. **Add app → iOS**.
2. **Apple bundle ID:** `com.mealadda.app`.
3. Nickname: `MealAdda iOS`. App Store ID: leave empty.
4. **Register app** → **Download `GoogleService-Info.plist`**.
5. Put it at:

   ```
   mobile/ios/Runner/GoogleService-Info.plist
   ```

6. ⚠️ **Copying the file is not enough** — it has to be part of the Xcode
   target or the app ships without it and Firebase fails to start at runtime:

   - Open `mobile/ios/Runner.xcworkspace` (the **workspace**, never the
     `.xcodeproj`).
   - Drag `GoogleService-Info.plist` from Finder into the `Runner` folder in
     Xcode's left sidebar.
   - In the dialog: tick **Copy items if needed**, and under _Add to targets_
     tick **Runner**. Finish.

---

## 4. Apple: register the App ID and create the APNs key

Firebase cannot deliver to iPhones without this. Do it at
<https://developer.apple.com/account> → _Certificates, Identifiers & Profiles_.

### 4a. The App ID, with push enabled

1. **Identifiers → +** → App IDs → App.
2. Description: `MealAdda`. Bundle ID: **Explicit**, `com.mealadda.app`.
3. In the Capabilities list, tick **Push Notifications**.
4. Register. (If `com.mealadda.app` is already registered, open it and make sure
   Push Notifications is ticked, then Save.)

### 4b. The APNs key

1. **Keys → +**.
2. Key Name: `MealAdda APNs`.
3. Tick **Apple Push Notifications service (APNs)** → Configure → Sandbox &
   Production → Save → Continue → Register.
4. **Download** the `.p8`. This is the one-time download — save it next to your
   upload keystore.
5. Note the **Key ID** shown on that page (10 characters).
6. Your **Team ID** is `M7ZGXF8RPW` (already in the Xcode project).

### 4c. Upload it into Firebase

1. Firebase Console → ⚙ **Project settings → Cloud Messaging**.
2. Under **Apple app configuration**, find the iOS app → **APNs Authentication
   Key → Upload**.
3. Upload the `.p8`, and enter the **Key ID** and **Team ID** from above.

---

## 5. Xcode capabilities

Open `mobile/ios/Runner.xcworkspace`, select the **Runner** target →
**Signing & Capabilities**:

1. **+ Capability → Push Notifications.** (This creates `Runner.entitlements`
   with `aps-environment`, which is what Apple checks at review.)
2. **+ Capability → Background Modes**, then tick **Remote notifications** —
   without it, a notification arriving while the app is backgrounded is
   dropped instead of delivered.

---

## 6. The server credential

1. Firebase Console → ⚙ **Project settings → Service accounts**.
2. **Generate new private key** → Generate key. A JSON file downloads.
3. Save it **outside the repo**, e.g. `~/mealadda-fcm.json`.
4. Turn it into one safe line:

   ```bash
   base64 -i ~/mealadda-fcm.json | pbcopy
   ```

   Base64 rather than raw JSON because a private key is full of newlines, and
   every environment-variable UI mangles them differently. The server accepts
   either form, but this one survives copy-paste.

5. Add it locally, in **`.env`** (not `.env.local` — see CLAUDE.md):

   ```
   FIREBASE_SERVICE_ACCOUNT_JSON=<paste>
   ```

6. Add the same variable on Vercel → Project → Settings → Environment
   Variables → **Production** (and Preview if you test there), then redeploy.
   Nothing picks up a new env var without a deploy.

---

## 7. State as of 22 Sep 2026

**Configured and proven, except delivery to a real handset.**

- `npm run verify:push` authenticates against project `mealadda-49d4f` and the
  project accepts our messages.
- **Android** builds; `google_app_id` compiles to
  `1:119101508232:android:2c8008ecccfb2397b76d3d`, matching the config file, and
  `POST_NOTIFICATIONS` arrives automatically with `firebase_messaging` — no
  manual declaration needed.
- **iOS** builds; `GoogleService-Info.plist` is **inside** `Runner.app` (the
  step that silently fails when the file is only on disk), `UIBackgroundModes`
  carries `remote-notification`, and the Firebase frameworks are bundled.

**Still to do:**

1. `FIREBASE_SERVICE_ACCOUNT_JSON` on **Vercel** (Production), then redeploy.
   It is only in local `.env` today, so production still cannot send.
2. **Deliver to a physical device.** Everything above proves configuration, not
   delivery: nothing has yet put a notification on a real lock screen. iOS push
   does not work in the Simulator, so this needs an iPhone signed in as a
   throwaway student, plus an Android device or a Play-services emulator.
3. **Update the store privacy answers** — see below.

## Store answers that change now push exists

A push token is a device identifier, and both stores treat it as collected data:

- **Play Data safety:** add **Device or other IDs** → collected, **linked to the
  user**, purpose **App functionality**. Not shared, not used for tracking.
- **App Store privacy:** add **Identifiers → Device ID**, linked to the user,
  App Functionality, **not used for tracking** (so no ATT prompt — that changes
  if ads ship, see RELEASE-MOBILE.md).
- The **privacy policy** should say the app stores a notification token per
  device and deletes it on sign-out and on account deletion, which is what the
  code does.

---

## Testing notes, for later

- **iOS push does not work in the Simulator** for FCM. A physical iPhone is
  required, signed in as a student.
- **Android emulators are fine**, as long as the image has Google Play services.
- A notification only arrives if the student **granted permission** — the app
  asks after sign-in, not on first launch, so the prompt has context.
- Deliveries are logged per event in `notification_deliveries` and shown on
  **Admin → Notifications → Recently sent**, with how many devices were reached.

---

## What is still deferred

**Plan reminders have no scheduler.** `/api/cron/plan-reminders` is built,
authenticated with `CRON_SECRET` and safe to call repeatedly, but nothing calls
it: Vercel's Hobby plan allows two cron jobs and both are taken by the headcount
snapshot. Options when you want it: fold it into the existing headcount cron,
schedule it from Supabase with pg_cron, or call it from a GitHub Actions
schedule. Until then, the other three notification kinds work and reminders
simply never fire.
