import 'package:flutter_test/flutter_test.dart';
import 'package:mealadda/src/core/app_info.dart';
import 'package:mealadda/src/core/legal_links.dart';

/// The account menu's links to the public legal pages.
///
/// Apple rejects an app whose privacy policy and account deletion are reachable
/// only from the store listing, so these have to open real pages. A link that
/// resolved to the wrong host, or to a path the web never served, would pass
/// review on the listing and fail it in the app.
void main() {
  test('every link opens a page under the permanent website', () {
    for (final link in LegalLinks.all) {
      expect(link.uri.scheme, 'https');
      expect(link.uri.origin, AppInfo.website);
    }
  });

  test('offers privacy, terms, account deletion and support, in that order', () {
    expect(LegalLinks.all.map((l) => l.uri.path).toList(), [
      '/privacy',
      '/terms',
      '/delete-account',
      '/support',
    ]);
  });

  test('labels are unique so the menu can key on them', () {
    final labels = LegalLinks.all.map((l) => l.label).toList();
    expect(labels.toSet().length, labels.length);
  });
}
