# Mobile app

The Flutter client for students and counter staff. Admin stays on the Next.js
web console — see the repository root [`CLAUDE.md`](../CLAUDE.md).

**The product name is deliberately not written here.** It lives in
[`app.config.json`](../app.config.json) at the repository root, and
`scripts/apply-app-identity.mjs` propagates it into the Android string resource,
the iOS plist, `pubspec.yaml` and the generated Dart and TypeScript constants.
Store names must be globally unique, so this one changed four times before it
stuck; every literal that duplicated it went stale at least once.

```bash
npm run app:name        # display name → Dart, TS, strings.xml, Info.plist, pubspec
npm run app:bundle-id   # bundle id → Gradle, Kotlin package, Xcode, package names
```

`tests/unit/app-identity.test.ts` fails if any of those drift apart.

## Running it

```bash
flutter pub get
flutter run                       # hits the production API by default
flutter run --dart-define=API_BASE_URL=http://localhost:3100
```

The base URL defaults to production on purpose: Xcode does not pass
`--dart-define`, so a localhost default meant every device build failed with a
connection error that looked like a server outage.

**On iOS, open `ios/Runner.xcworkspace`** — never `Runner.xcodeproj`. The
`.xcodeproj` alone has no CocoaPods, so plugins fail to resolve at build time
(`Module 'flutter_secure_storage_darwin' not found`). Run
`flutter build ios --config-only` first if the workspace is missing.

## Checks

```bash
flutter analyze
flutter test
```

## Architecture

- `lib/src/core` — configuration, money, failures. No Flutter imports.
- `lib/src/design` — tokens, theme, shared components. Every screen builds from
  here; see [`docs/DESIGN.md`](../docs/DESIGN.md) before adding a screen.
- `lib/src/data` — API client, repositories, models.
- `lib/src/features` — `auth`, `student`, `staff`, one folder per screen.
- `lib/src/state` — Riverpod providers.

No business rule is reimplemented in Dart. Eligibility, absence caps, pricing
and idempotency all stay in `src/core` on the server, reached over `/api/*`.
