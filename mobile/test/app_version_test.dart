import 'package:flutter_test/flutter_test.dart';
import 'package:mealadda/src/core/app_info.dart';
import 'package:mealadda/src/state/app_version.dart';

/// The force-update decision.
///
/// This is the only code in the app that can stop every student eating, and it
/// runs before anyone has signed in. So it blocks on exactly one condition — a
/// number from the server that is higher than this build — and treats every
/// other answer, including a broken one, as "carry on".
void main() {
  test('blocks a build older than the server requires', () {
    final requirement = updateRequirementFrom({'minimumBuild': 7}, build: 6);
    expect(requirement.required, isTrue);
  });

  test('lets the exact minimum through', () {
    // Off by one here means the release you just shipped locks itself out.
    expect(updateRequirementFrom({'minimumBuild': 7}, build: 7).required, isFalse);
    expect(updateRequirementFrom({'minimumBuild': 7}, build: 8).required, isFalse);
  });

  test('blocks nobody when the server says nothing useful', () {
    for (final json in <Map<String, dynamic>>[
      {},
      {'minimumBuild': null},
      {'minimumBuild': 'seven'},
    ]) {
      expect(updateRequirementFrom(json, build: 1).required, isFalse);
    }
  });

  test('ignores an update link that is not https', () {
    // The URL comes off the network and is handed to the system browser.
    final requirement = updateRequirementFrom({
      'minimumBuild': 9,
      'updateUrl': 'javascript:alert(1)',
    }, build: 1);

    expect(requirement.updateUrl, AppInfo.website);
  });

  test('shows the server’s wording when it sends one', () {
    final requirement = updateRequirementFrom({
      'minimumBuild': 9,
      'message': 'Your mess needs the new app.',
    }, build: 1);

    expect(requirement.message, 'Your mess needs the new app.');
  });
}
