/// Whether this build is still allowed to talk to the mess (D-33).
///
/// This exists because it cannot be added later. Once a student has the app on
/// their phone, the only thing that can tell them to update is code that is
/// already in it — so the check ships in the first release, months before the
/// first breaking change it is meant to catch.
///
/// **Fails open.** Rule 7 says fail closed on security and money; this is
/// neither. A mess counter on dropped wifi that could not reach this endpoint
/// would show every student an update screen for an update they do not need,
/// during service. An unreachable server means "carry on", and the block only
/// happens when the server actually says so.
library;

import '../core/app_info.dart';

class UpdateRequirement {
  const UpdateRequirement({
    required this.required,
    required this.message,
    required this.updateUrl,
  });

  const UpdateRequirement.none()
    : required = false,
      message = '',
      updateUrl = AppInfo.website;

  final bool required;
  final String message;
  final String updateUrl;
}

/// Reads the server's answer. Pure, so the decision can be tested without a
/// server: this is the code that can lock every student out of their meals by
/// being wrong about a comparison.
UpdateRequirement updateRequirementFrom(
  Map<String, dynamic> json, {
  int build = AppInfo.build,
}) {
  final minimum = json['minimumBuild'];
  // A malformed or missing answer blocks nobody. Only a number the app can
  // actually compare against is allowed to stop anyone eating.
  if (minimum is! int || build >= minimum) return const UpdateRequirement.none();

  final url = json['updateUrl'];
  final message = json['message'];

  return UpdateRequirement(
    required: true,
    message: message is String && message.isNotEmpty
        ? message
        : 'Update the app to carry on. This version can no longer reach the mess.',
    updateUrl: url is String && url.startsWith('https://') ? url : AppInfo.website,
  );
}
