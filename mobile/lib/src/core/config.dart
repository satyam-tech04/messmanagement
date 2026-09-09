/// Build-time configuration.
///
/// The API base URL is a `--dart-define`, not a checked-in constant, because
/// the same source has to build against a local dev server, a Vercel preview
/// and production. Baking one in would mean a release build could silently ship
/// pointing at a developer's laptop.
///
///   flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3100
///   flutter build apk --dart-define=API_BASE_URL=https://your-deployment
///
/// Note the Android emulator address: `localhost` inside the emulator is the
/// emulator itself, so a dev server on the host is reached at `10.0.2.2`. On a
/// physical device over Wi-Fi it is the machine's LAN address. This is the first
/// thing to check when the app "cannot reach the server" but curl works.
library;

class AppConfig {
  const AppConfig._();

  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:3000',
  );

  /// Fails loudly at startup rather than on the first request, where the error
  /// would surface as a confusing network failure on the login screen.
  static void assertConfigured() {
    assert(
      apiBaseUrl.startsWith('http://') || apiBaseUrl.startsWith('https://'),
      'API_BASE_URL must be an absolute http(s) URL, got: $apiBaseUrl',
    );
  }
}
