/// Deleting your account, from inside the app (D-32).
///
/// Both stores require this to be startable here rather than by emailing
/// somebody, and it is the only screen in the app that takes something away
/// permanently. So it is deliberately slow: what goes and what stays, in the
/// same words as the published policy, then the word DELETE typed out, and only
/// then a destructive button.
///
/// The moment the server accepts it the session is dead — the profile is
/// disabled, so the tokens on this phone stop working on their next request.
/// The screen therefore signs out itself rather than leaving the app holding
/// credentials that will fail on the next tap.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_failure.dart';
import '../../core/app_info.dart';
import '../../core/legal_links.dart';
import '../../design/components.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../state/auth_controller.dart';
import '../../state/student_providers.dart';

class DeleteAccountScreen extends ConsumerStatefulWidget {
  const DeleteAccountScreen({super.key});

  @override
  ConsumerState<DeleteAccountScreen> createState() =>
      _DeleteAccountScreenState();
}

class _DeleteAccountScreenState extends ConsumerState<DeleteAccountScreen> {
  final _confirm = TextEditingController();
  bool _busy = false;
  String? _error;
  String? _eraseBy;

  @override
  void initState() {
    super.initState();
    // Enables the button the moment the word is right, rather than waiting for
    // a submit to tell someone they typed it wrong.
    _confirm.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _confirm.dispose();
    super.dispose();
  }

  bool get _confirmed => _confirm.text.trim().toUpperCase() == 'DELETE';

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      final eraseBy = await ref.read(deleteAccountProvider.future);
      if (!mounted) return;
      setState(() {
        _eraseBy = eraseBy;
        _busy = false;
      });
    } on ApiFailure catch (failure) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = failure.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_eraseBy != null) return _Done(eraseBy: _eraseBy!);

    return Scaffold(
      appBar: AppBar(title: const Text('Delete account')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(Space.lg),
          children: [
            MessCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'You will be signed out straight away',
                    style: context.texts.titleMedium,
                  ),
                  const Gap.sm(),
                  Text(
                    'Your mess is told, and your personal details are erased '
                    'within 30 days. You cannot use ${AppInfo.name} in the '
                    'meantime — even if you have already paid for meals this '
                    'month.',
                    style: context.texts.bodyMedium,
                  ),
                ],
              ),
            ),
            const Gap.lg(),
            const _Bullets(
              title: 'What is deleted',
              icon: Icons.delete_outline_rounded,
              items: [
                'Your sign-in, so you can no longer use the app',
                'Your name, mobile number, email and room',
                'Your photograph',
                'Your meal ratings and comments',
              ],
            ),
            const Gap.md(),
            const _Bullets(
              title: 'What your mess keeps',
              icon: Icons.receipt_long_outlined,
              items: [
                'What it served and what was paid, for its own accounts',
                'These records are no longer linked to your name',
              ],
            ),
            const Gap.md(),
            TextButton.icon(
              onPressed: () => launchUrl(
                LegalLinks.deleteAccount.uri,
                mode: LaunchMode.externalApplication,
              ),
              icon: const Icon(Icons.open_in_new_rounded, size: 18),
              label: const Text('Read the full policy'),
            ),
            const Gap.lg(),
            Text('Type DELETE to confirm', style: context.texts.labelLarge),
            const Gap.sm(),
            TextField(
              controller: _confirm,
              autocorrect: false,
              enableSuggestions: false,
              textCapitalization: TextCapitalization.characters,
              decoration: const InputDecoration(hintText: 'DELETE'),
            ),
            if (_error != null) ...[
              const Gap.md(),
              // Colour is never the only signal (DESIGN.md) — the icon and the
              // sentence carry it too.
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.error_outline_rounded,
                    size: 18,
                    color: context.colors.error,
                  ),
                  const SizedBox(width: Space.sm),
                  Expanded(
                    child: Text(
                      _error!,
                      style: context.texts.bodySmall?.copyWith(
                        color: context.colors.error,
                      ),
                    ),
                  ),
                ],
              ),
            ],
            const Gap.lg(),
            FilledButton(
              onPressed: _confirmed && !_busy ? _submit : null,
              style: FilledButton.styleFrom(
                backgroundColor: context.colors.error,
                foregroundColor: context.colors.onError,
              ),
              child: _busy
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Delete my account'),
            ),
            const Gap.md(),
            TextButton(
              onPressed: _busy ? null : () => Navigator.of(context).pop(),
              child: const Text('Keep my account'),
            ),
          ],
        ),
      ),
    );
  }
}

class _Bullets extends StatelessWidget {
  const _Bullets({
    required this.title,
    required this.icon,
    required this.items,
  });

  final String title;
  final IconData icon;
  final List<String> items;

  @override
  Widget build(BuildContext context) {
    return MessCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 18, color: context.colors.onSurfaceVariant),
              const SizedBox(width: Space.sm),
              Text(title, style: context.texts.titleSmall),
            ],
          ),
          const Gap.sm(),
          for (final item in items)
            Padding(
              padding: const EdgeInsets.only(bottom: Space.xs),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('•  ', style: context.texts.bodyMedium),
                  Expanded(child: Text(item, style: context.texts.bodyMedium)),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// Shown once the server has accepted it. There is no way back to the app from
/// here: the session is already dead, so the only action is to sign out.
class _Done extends ConsumerWidget {
  const _Done({required this.eraseBy});

  final String eraseBy;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(Space.lg),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                Icons.check_circle_outline_rounded,
                size: 44,
                color: context.colors.primary,
              ),
              const Gap.md(),
              Text('Your account is closing', style: context.texts.titleLarge),
              const Gap.sm(),
              Text(
                'You are signed out. Your mess has been told, and your personal '
                'details will be erased by $eraseBy.',
                style: context.texts.bodyMedium,
              ),
              const Gap.sm(),
              Text(
                'Changed your mind? Ask your mess office before that date, or '
                'write to ${AppInfo.supportEmail}.',
                style: context.texts.bodySmall?.copyWith(
                  color: context.colors.onSurfaceVariant,
                ),
              ),
              const Gap.lg(),
              FilledButton(
                onPressed: () =>
                    ref.read(authControllerProvider.notifier).forgetSession(),
                child: const Text('Close'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
