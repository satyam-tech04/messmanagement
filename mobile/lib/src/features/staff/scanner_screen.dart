/// The counter scanner.
///
/// The most safety-critical screen in the product: a queue of students is
/// waiting, and every second here is multiplied by two hundred people. The
/// design follows from that.
///
///  - **The result covers the viewfinder.** Staff are looking at the student,
///    not the tablet, so the answer has to be unmissable rather than tucked in
///    a corner.
///  - **Colour and sound, always both.** A tablet under a serving counter's
///    lighting, held by someone who may have a colour-vision deficiency.
///  - **A refusal never offers the manual fallback.** Manual entry runs the
///    identical eligibility check, so offering it to a genuinely ineligible
///    student produces the same refusal while implying it might not.
///  - **A dropped connection is not a refusal.** It is buffered and the student
///    is served — turning someone away over counter Wi-Fi is the thing the
///    offline queue exists to prevent.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../core/config.dart';
import '../../data/session.dart';
import '../../design/status_badge.dart';
import '../../design/theme.dart';
import '../../state/auth_controller.dart';
import 'manual_entry_sheet.dart';
import 'scan_beeper.dart';
import 'scan_gate.dart';
import 'scan_queue.dart';
import 'verify_repository.dart';

/// How long a result stays up before the camera takes over again.
///
/// A success is short — staff have already seen the green and the next student
/// is stepping forward. A denial is long enough to read the action line, which
/// is the whole reason it exists.
const _successMs = 1100;
const _denialMs = 2600;

final scanQueueProvider = Provider<ScanQueue>((ref) => ScanQueue());

final verifyRepositoryProvider = Provider<VerifyRepository>((ref) {
  return VerifyRepository(
    api: ref.watch(apiClientProvider),
    queue: ref.watch(scanQueueProvider),
  );
});

class ScannerScreen extends ConsumerStatefulWidget {
  const ScannerScreen({super.key, required this.session});

  final Session session;

  @override
  ConsumerState<ScannerScreen> createState() => _ScannerScreenState();
}

class _ScannerScreenState extends ConsumerState<ScannerScreen> {
  final _camera = MobileScannerController(
    formats: const [BarcodeFormat.qrCode],
    detectionSpeed: DetectionSpeed.normal,
  );
  final _beeper = ScanBeeper();

  LastScan? _last;
  bool _busy = false;
  VerifyResult? _result;
  Timer? _dismiss;
  Timer? _flushTimer;

  int _servedCount = 0;
  int _expiredCount = 0;

  /// An audit label only. It must never key a rate limit: anything the caller
  /// controls can be varied per request, so a runaway loop would mint a new
  /// bucket each time and the limit would never bite. The counter identity that
  /// cannot be forged is the signed-in staff account.
  String get _deviceId =>
      'counter-${widget.session.tenantSlug}-${widget.session.fullName.hashCode.abs() % 100000}';

  @override
  void initState() {
    super.initState();
    _flush();
    // Retry the buffered scans periodically as well as on demand: counter
    // Wi-Fi returns without anyone noticing, and nobody should have to
    // remember to press something.
    _flushTimer = Timer.periodic(const Duration(seconds: 15), (_) => _flush());
  }

  @override
  void dispose() {
    _dismiss?.cancel();
    _flushTimer?.cancel();
    _camera.dispose();
    _beeper.dispose();
    super.dispose();
  }

  Future<void> _flush() async {
    final synced = await ref.read(verifyRepositoryProvider).flush();
    final stale = await ref.read(scanQueueProvider).expired();
    if (!mounted) return;
    setState(() {
      _servedCount += synced;
      _expiredCount = stale.length;
    });
  }

  Future<void> _onDetect(BarcodeCapture capture) async {
    final raw = capture.barcodes.firstOrNull?.rawValue;
    if (raw == null || raw.isEmpty) return;

    if (!shouldSubmitToken(
      token: raw,
      last: _last,
      now: DateTime.now(),
      busy: _busy,
    )) {
      return;
    }

    // Recorded only now — after the gate said yes. Recording before the busy
    // check would suppress the retry milliseconds later and lose the scan.
    _last = LastScan(token: raw, at: DateTime.now());
    _busy = true;

    final result = await ref
        .read(verifyRepositoryProvider)
        .verifyQr(token: raw, deviceId: _deviceId);

    if (!mounted) return;
    _show(result);
  }

  void _show(VerifyResult result) {
    _beeper.play(result.outcome.tone);

    setState(() {
      _result = result;
      if (result.code == 'SERVED' || result.queued) _servedCount++;
    });

    _dismiss?.cancel();
    _dismiss = Timer(
      Duration(
        milliseconds: result.outcome.tone == StatusTone.active
            ? _successMs
            : _denialMs,
      ),
      () {
        if (!mounted) return;
        setState(() {
          _result = null;
          _busy = false;
        });
      },
    );
  }

  Future<void> _openManual({String? prefillRoll}) async {
    // Free the gate first: the dialog owns the interaction now, and leaving
    // `_busy` set would silently swallow every read after it closes.
    _dismiss?.cancel();
    setState(() {
      _result = null;
      _busy = false;
    });

    final result = await showModalBottomSheet<VerifyResult>(
      context: context,
      isScrollControlled: true,
      builder: (_) => ManualEntrySheet(
        deviceId: _deviceId,
        prefillRoll: prefillRoll,
      ),
    );

    if (result != null && mounted) _show(result);
  }

  @override
  Widget build(BuildContext context) {
    final result = _result;

    return Stack(
      fit: StackFit.expand,
      children: [
        MobileScanner(controller: _camera, onDetect: _onDetect),

        // Framing guide. Staff aim faster at a drawn box than at open video.
        IgnorePointer(
          child: Center(
            child: Container(
              width: 240,
              height: 240,
              decoration: BoxDecoration(
                border: Border.all(color: Colors.white70, width: 3),
                borderRadius: BorderRadius.circular(24),
              ),
            ),
          ),
        ),

        if (result != null) _ResultOverlay(result: result, onManual: _openManual),

        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          child: _CounterBar(
            servedCount: _servedCount,
            expiredCount: _expiredCount,
            onManual: () => _openManual(),
            onDismissExpired: () async {
              await ref.read(scanQueueProvider).clearExpired();
              if (mounted) setState(() => _expiredCount = 0);
            },
          ),
        ),
      ],
    );
  }
}

class _ResultOverlay extends StatelessWidget {
  const _ResultOverlay({required this.result, required this.onManual});

  final VerifyResult result;
  final void Function({String? prefillRoll}) onManual;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<MessColors>()!;
    final outcome = result.outcome;

    final (background, foreground) = switch (outcome.tone) {
      StatusTone.active => (colors.statusActive, colors.statusActiveFg),
      StatusTone.warning => (colors.statusWarning, colors.statusWarningFg),
      StatusTone.danger => (colors.statusDanger, colors.statusDangerFg),
      StatusTone.neutral => (colors.statusNeutral, colors.statusNeutralFg),
    };

    return Container(
      color: background,
      padding: const EdgeInsets.all(28),
      child: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (result.photoUrl != null)
                  ClipOval(
                    child: Image.network(
                      '${AppConfig.apiBaseUrl}${result.photoUrl}',
                      width: 128,
                      height: 128,
                      fit: BoxFit.cover,
                      errorBuilder: (_, _, _) => _NoPhoto(colour: foreground),
                    ),
                  )
                else if (outcome.tone == StatusTone.active)
                  _NoPhoto(colour: foreground),

                const SizedBox(height: 20),
                Text(
                  outcome.title,
                  style: TextStyle(
                    color: foreground,
                    fontSize: 34,
                    fontWeight: FontWeight.w800,
                  ),
                  textAlign: TextAlign.center,
                ),
                if (result.fullName != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    result.fullName!,
                    style: TextStyle(
                      color: foreground,
                      fontSize: 22,
                      fontWeight: FontWeight.w600,
                    ),
                    textAlign: TextAlign.center,
                  ),
                ],
                if (result.rollNumber != null)
                  Text(
                    result.rollNumber!,
                    style: TextStyle(color: foreground, fontSize: 16),
                  ),
                const SizedBox(height: 14),
                Text(
                  outcome.action,
                  style: TextStyle(color: foreground, fontSize: 17),
                  textAlign: TextAlign.center,
                ),
                if (outcome.allowsManualOverride) ...[
                  const SizedBox(height: 20),
                  FilledButton.icon(
                    onPressed: () => onManual(prefillRoll: result.rollNumber),
                    icon: const Icon(Icons.edit_note_rounded),
                    label: const Text('Enter manually'),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _NoPhoto extends StatelessWidget {
  const _NoPhoto({required this.colour});
  final Color colour;

  @override
  Widget build(BuildContext context) => Column(
    mainAxisSize: MainAxisSize.min,
    children: [
      Icon(Icons.person_outline_rounded, size: 72, color: colour),
      const SizedBox(height: 4),
      // Said explicitly rather than left blank: a missing photo means staff must
      // check ID themselves, and silence would read as "verified".
      Text(
        'No photo on file — check their ID',
        style: TextStyle(color: colour, fontSize: 13),
      ),
    ],
  );
}

class _CounterBar extends StatelessWidget {
  const _CounterBar({
    required this.servedCount,
    required this.expiredCount,
    required this.onManual,
    required this.onDismissExpired,
  });

  final int servedCount;
  final int expiredCount;
  final VoidCallback onManual;
  final VoidCallback onDismissExpired;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Held-back scans. These are students who already ate and whose
            // record cannot now be filed against the right day, so they are
            // surfaced rather than dropped — losing them silently would erase a
            // whole service with nobody ever knowing.
            if (expiredCount > 0)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Material(
                  color: theme.colorScheme.errorContainer,
                  borderRadius: BorderRadius.circular(12),
                  child: InkWell(
                    onTap: onDismissExpired,
                    borderRadius: BorderRadius.circular(12),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 10,
                      ),
                      child: Text(
                        '$expiredCount scan${expiredCount == 1 ? '' : 's'} not '
                        'recorded — tell the admin, then tap to dismiss',
                        style: TextStyle(
                          color: theme.colorScheme.onErrorContainer,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 12,
                  ),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surface.withValues(alpha: 0.92),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    'Served $servedCount',
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontFeatures: [FontFeature.tabularFigures()],
                    ),
                  ),
                ),
                const Spacer(),
                FilledButton.tonalIcon(
                  onPressed: onManual,
                  icon: const Icon(Icons.edit_note_rounded),
                  label: const Text('Manual'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
