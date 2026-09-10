/// The student's rotating meal code — the screen the whole product turns on.
///
/// Held up at a counter with a queue behind it, so every decision here is about
/// the twenty seconds around a scan:
///
///  - **Hidden until tapped.** Opening the app costs nothing.
///  - **Maximum screen brightness while shown.** A dim phone in a bright hall is
///    a real scan failure, and this is the clearest thing the native app does
///    that the web version could not.
///  - **Always on white, never themed.** A dark-mode QR is a QR a camera cannot
///    read; inverted modules break the finder pattern.
///  - **Denials are designed screens**, not toasts. A blocked student needs to
///    be told to see the office, not shown a banner that vanishes.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:screen_brightness/screen_brightness.dart';

import '../../data/qr_token.dart';
import '../../data/session.dart';
import '../../design/async_view.dart';
import '../../design/feedback.dart';
import 'qr_controller.dart';
import 'qr_state.dart';
import '../../design/components.dart';
import '../../design/tokens.dart';

/// The rendered size of the symbol.
///
/// Matches the web at 280 logical pixels. Bigger is not automatically better:
/// past a point the limit is the scanner's focus distance, not the symbol size.
const double _qrSize = 280;

class QrScreen extends ConsumerStatefulWidget {
  const QrScreen({super.key, required this.session});

  final Session session;

  @override
  ConsumerState<QrScreen> createState() => _QrScreenState();
}

class _QrScreenState extends ConsumerState<QrScreen>
    with WidgetsBindingObserver {
  bool _brightnessRaised = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    // Restore before leaving, always. Leaving a phone pinned at full brightness
    // after the student walks away from the counter would drain a battery they
    // need for the next meal.
    _restoreBrightness();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final controller = ref.read(qrControllerProvider.notifier);
    if (state == AppLifecycleState.resumed) {
      controller.onResumed();
    } else if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.inactive) {
      controller.onPaused();
      _restoreBrightness();
    }
  }

  Future<void> _raiseBrightness() async {
    if (_brightnessRaised) return;
    _brightnessRaised = true;
    try {
      await ScreenBrightness.instance.setApplicationScreenBrightness(1);
    } catch (_) {
      // Brightness is a nicety, not a requirement. A platform that refuses it
      // must not stop the code being shown.
    }
  }

  Future<void> _restoreBrightness() async {
    if (!_brightnessRaised) return;
    _brightnessRaised = false;
    try {
      await ScreenBrightness.instance.resetApplicationScreenBrightness();
    } catch (_) {
      /* see above */
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(qrControllerProvider);

    // Only a code on screen justifies overriding the student's own brightness.
    if (state is QrReady) {
      _raiseBrightness();
    } else {
      _restoreBrightness();
    }

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: Space.xxl,
          vertical: Space.lg,
        ),
        child: Center(
          child: SingleChildScrollView(child: _body(context, state)),
        ),
      ),
    );
  }

  void _reveal() {
    Haptics.tap();
    ref.read(qrControllerProvider.notifier).reveal();
  }

  Widget _body(BuildContext context, QrState state) => switch (state) {
    QrHidden() => _Reveal(name: widget.session.fullName, onReveal: _reveal),
    QrExpired() => _Reveal(
      name: widget.session.fullName,
      expired: true,
      onReveal: _reveal,
    ),
    QrLoading() => const _LoadingCode(),
    QrReady(:final token) => _LiveCode(token: token, session: widget.session),
    QrServed(:final mealSlot, :final servedAt) => _Served(
      mealSlot: mealSlot,
      servedAt: servedAt,
      timezone: widget.session.timezone,
    ),
    QrDenied() => _Denied(
      state: state,
      onRetry: () => ref.read(qrControllerProvider.notifier).reveal(),
    ),
    QrOffline() => ErrorState(
      failure: 'offline',
      onRetry: () => ref.read(qrControllerProvider.notifier).reveal(),
    ),
  };
}

/// The resting state, and the one after a code is put away.
class _Reveal extends StatelessWidget {
  const _Reveal({
    required this.name,
    required this.onReveal,
    this.expired = false,
  });

  final String name;
  final VoidCallback onReveal;
  final bool expired;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(
          Icons.qr_code_2_rounded,
          size: 72,
          color: theme.colorScheme.primary,
        ),
        const Gap.xl(),
        Text(
          expired ? 'Code put away' : 'Show this at the counter',
          style: theme.textTheme.titleLarge?.copyWith(
            fontWeight: FontWeight.w700,
          ),
          textAlign: TextAlign.center,
        ),
        const Gap.sm(),
        Text(
          expired
              ? 'Tap again when you reach the counter — you will get a fresh code.'
              : 'Tap to show your meal code. It changes every few seconds.',
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
          textAlign: TextAlign.center,
        ),
        const Gap.xxl(),
        SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            onPressed: onReveal,
            icon: const Icon(Icons.qr_code_rounded),
            label: Text(expired ? 'Show a fresh code' : 'Show my code'),
          ),
        ),
      ],
    );
  }
}

class _LoadingCode extends StatelessWidget {
  const _LoadingCode();

  @override
  Widget build(BuildContext context) => const Column(
    mainAxisSize: MainAxisSize.min,
    children: [
      // Sized exactly like the real symbol, so revealing a code does not shift
      // the layout under a thumb already moving toward it.
      Skeleton(height: _qrSize, width: _qrSize, radius: Radii.xl),
      Gap.xxl(),
      Skeleton(height: 18, width: 160),
      Gap.sm(),
      Skeleton(height: 14, width: 200),
    ],
  );
}

class _LiveCode extends StatelessWidget {
  const _LiveCode({required this.token, required this.session});

  final QrToken token;
  final Session session;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // Always white, in both themes. A themed QR is an unreadable QR.
        Container(
          padding: const EdgeInsets.all(Space.lg),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(Radii.xl),
            boxShadow: const [
              BoxShadow(color: Color(0x14000000), blurRadius: 24),
            ],
          ),
          child: QrImageView(
            data: token.token,
            version: QrVersions.auto,
            size: _qrSize,
            backgroundColor: Colors.white,
            // Level M, not H. Error correction exists for *physical* damage —
            // creases, dirt, print wear — none of which applies to a code that
            // lives seconds on a backlit screen. What H costs is density: on a
            // real token it produces an 81x81 grid where M gives 61x61, which
            // at this size is a quarter less module for the camera to resolve.
            // That is what decides whether it locks on at arm's length.
            errorCorrectionLevel: QrErrorCorrectLevel.M,
            // The specification mandates a four-module quiet zone and decoders
            // rely on it to find the symbol's edges. A scanner that cannot
            // locate the finder pattern does not decode slowly — it does not
            // decode at all.
            padding: const EdgeInsets.all(Space.md),
          ),
        ),
        const Gap.xxl(),
        Text(
          session.fullName,
          style: theme.textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.w700,
          ),
        ),
        Text(
          token.rollNumber,
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
        const Gap.lg(),
        Container(
          padding: const EdgeInsets.symmetric(
            horizontal: Space.md,
            vertical: Space.sm,
          ),
          decoration: BoxDecoration(
            color: theme.colorScheme.secondaryContainer,
            borderRadius: BorderRadius.circular(Radii.pill),
          ),
          child: Text(
            _slotLabel(token.mealSlot),
            style: TextStyle(
              color: theme.colorScheme.onSecondaryContainer,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        const Gap.xl(),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.autorenew_rounded,
              size: 16,
              color: theme.colorScheme.onSurfaceVariant,
            ),
            const Gap.sm(),
            Text(
              'Changes every ${token.refreshSeconds} seconds',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// The receipt. The best moment in the app: the student has their food and
/// nothing is pending.
class _Served extends StatelessWidget {
  const _Served({
    required this.mealSlot,
    required this.servedAt,
    required this.timezone,
  });

  final String mealSlot;
  final DateTime? servedAt;
  final String timezone;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(
          Icons.check_circle_rounded,
          size: 88,
          color: theme.colorScheme.primary,
        ),
        const Gap.xl(),
        Text(
          '${_slotLabel(mealSlot)} served',
          style: theme.textTheme.headlineSmall?.copyWith(
            fontWeight: FontWeight.w700,
          ),
          textAlign: TextAlign.center,
        ),
        const Gap.sm(),
        Text(
          'You are all set. Enjoy your meal.',
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
          textAlign: TextAlign.center,
        ),
      ],
    );
  }
}

/// A decision, explained — with what the student can actually do about it.
class _Denied extends StatelessWidget {
  const _Denied({required this.state, required this.onRetry});

  final QrDenied state;
  final VoidCallback onRetry;

  /// What each refusal means for the person holding the phone.
  ///
  /// The server's own message is shown too, but these headings turn a code into
  /// a sentence a hungry student can act on.
  (IconData, String, String?) get _presentation => switch (state.code) {
    'BLOCKED_UNPAID' => (
      Icons.lock_outline_rounded,
      'Your meals are on hold',
      'Please settle your dues at the mess office.',
    ),
    'NO_ACTIVE_PLAN' => (
      Icons.card_membership_outlined,
      'No active plan',
      'Ask the mess office to start or renew your plan.',
    ),
    'ON_MESS_CUT' => (
      Icons.event_busy_rounded,
      'You marked this meal off',
      'You asked to skip this one. Your code returns for the next meal.',
    ),
    'SUBSCRIPTION_PAUSED' => (
      Icons.pause_circle_outline_rounded,
      'Your plan is paused',
      state.resumeDate == null ? null : 'It resumes on ${state.resumeDate}.',
    ),
    'SLOT_NOT_SERVED' => (
      Icons.no_meals_outlined,
      'This meal is not served',
      null,
    ),
    'OUTSIDE_MEAL_HOURS' => (
      Icons.schedule_rounded,
      'The counter is closed',
      null,
    ),
    'STUDENT_INACTIVE' => (
      Icons.person_off_outlined,
      'Your account is inactive',
      'Please speak to the mess office.',
    ),
    _ => (Icons.error_outline_rounded, 'Code unavailable', null),
  };

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final (icon, title, hint) = _presentation;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 72, color: theme.colorScheme.error),
        const Gap.xl(),
        Text(
          title,
          style: theme.textTheme.titleLarge?.copyWith(
            fontWeight: FontWeight.w700,
          ),
          textAlign: TextAlign.center,
        ),
        const Gap.sm(),
        Text(
          // The server writes for the person reading it; prefer its words and
          // fall back to ours only when there is nothing better to add.
          hint ?? state.message,
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
          textAlign: TextAlign.center,
        ),
        const Gap.xxl(),
        FilledButton.tonalIcon(
          onPressed: onRetry,
          icon: const Icon(Icons.refresh_rounded),
          label: const Text('Check again'),
        ),
      ],
    );
  }
}

String _slotLabel(String slot) => slot.isEmpty
    ? slot
    : slot[0].toUpperCase() + slot.substring(1).toLowerCase();
