/// The wall an out-of-date app hits (D-33).
///
/// Shown instead of everything else, before the session is even considered: an
/// app the server has disowned cannot be trusted to render a menu correctly,
/// and a student who is half-signed-in to a broken build is harder to help than
/// one looking at a single sentence and a button.
library;

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/app_info.dart';
import '../design/brand.dart';
import '../design/components.dart';
import '../design/theme.dart';
import '../design/tokens.dart';
import '../state/app_version.dart';

class UpdateRequiredScreen extends StatelessWidget {
  const UpdateRequiredScreen({super.key, required this.requirement});

  final UpdateRequirement requirement;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(Space.xl),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                const BrandMark(size: 96),
                const Gap.xl(),
                Text(
                  'Time to update',
                  style: context.texts.headlineSmall,
                  textAlign: TextAlign.center,
                ),
                const Gap.sm(),
                Text(
                  requirement.message,
                  style: context.texts.bodyMedium,
                  textAlign: TextAlign.center,
                ),
                const Gap.xl(),
                FilledButton(
                  onPressed: () => launchUrl(
                    Uri.parse(requirement.updateUrl),
                    mode: LaunchMode.externalApplication,
                  ),
                  child: const Text('Update now'),
                ),
                const Gap.md(),
                // Support needs to know which build somebody is stuck on, and
                // this screen is where they will be when they call.
                Text(
                  'Version ${AppInfo.version} (${AppInfo.build})',
                  style: context.texts.bodySmall?.copyWith(
                    color: context.colors.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
