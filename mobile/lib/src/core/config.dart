/// Build-time configuration.
///
/// The API base URL is a `--dart-define`, so the same source can build against
/// production, a Vercel preview or a local dev server.
///
///   flutter run   # production, no flag needed
///   flutter run --dart-define=API_BASE_URL=http://localhost:3100      # iOS sim
///   flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3100       # Android
///
/// **The default is production, deliberately.** It used to be `localhost:3000`,
/// and the first run from Xcode proved why that is the wrong way round: Xcode
/// does not pass `--dart-define`, so the app silently pointed at whatever
/// happened to be listening on the developer's own machine and failed with a
/// parse error. Defaulting to production means a forgotten flag still produces a
/// working app; pointing somewhere else is the deliberate act, which is the
/// safer direction for something that ships to a store.
///
/// Addresses differ per target and this is the first thing to check when the app
/// "cannot reach the server" but curl works:
///
///   - **iOS Simulator** shares the Mac's network, so `localhost` is the Mac.
///   - **Android emulator** is its own machine; the host is `10.0.2.2`.
///   - **A physical device** needs the host's LAN address, and both must be on
///     the same network.
library;

class AppConfig {
  const AppConfig._();

  /// Where the app points when nothing overrides it.
  ///
  /// Note this is a Vercel-generated hostname, derived from the project name.
  /// It is fine for testing, but it must be replaced with a custom domain
  /// before the first store release: this string is compiled into the binary,
  /// and changing it afterwards needs a store update that every already-installed
  /// app has to receive before it works again.
  static const String _productionBaseUrl =
      'https://messmanagement-lime.vercel.app';

  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: _productionBaseUrl,
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
