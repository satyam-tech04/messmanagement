/// Notices the moment staff scan, rather than up to a rotation later.
///
/// Without this the student holds a live code for as long as the refresh
/// interval after they have already been served: they see a QR, staff see a
/// green tick, and the natural reaction is to hold the phone up again at a
/// counter that will now refuse them.
///
/// Push, not polling. The socket costs nothing until a row actually arrives, and
/// it exists only while a code is on screen — so at most five minutes per
/// student, and none at all for anyone who never reveals one.
///
/// **`setAuth` is load-bearing.** Without the access token the channel evaluates
/// as anonymous, reports SUBSCRIBED perfectly happily, and then silently
/// delivers nothing. That failure looks exactly like "the feature does not work"
/// with no error anywhere, and cost the web version a debugging session.
///
/// The security boundary is `attendance_read_own` in the database, not the
/// client-side date check below — RLS is what stops this seeing another
/// student's meals.
library;

import 'dart:async';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../core/config.dart';

class AttendanceWatcher {
  RealtimeChannel? _channel;

  /// Watch for this student being served [mealSlot] on [serviceDate].
  ///
  /// [onServed] fires at most once per subscription; the caller is expected to
  /// leave the state it moves to.
  Future<void> watch({
    required String accessToken,
    required String serviceDate,
    required String mealSlot,
    required void Function(DateTime? scannedAt) onServed,
  }) async {
    await ensureRealtimeReady();
    await stop();

    final client = Supabase.instance.client;

    // The socket carries its own credentials, separate from the REST client's.
    // See the note above: skipping this fails silently rather than loudly.
    client.realtime.setAuth(accessToken);

    _channel = client
        .channel('my-attendance:$serviceDate:$mealSlot')
        .onPostgresChanges(
          event: PostgresChangeEvent.insert,
          schema: 'public',
          table: 'attendance',
          callback: (payload) {
            final row = payload.newRecord;

            // No server-side filter on student: RLS already restricts these
            // rows to this student. The meal check is here because the channel
            // sees every insert the student can read, and a breakfast row must
            // not close the lunch screen.
            if (row['service_date'] != serviceDate) return;
            if (row['meal_slot'] != mealSlot) return;

            final at = row['scanned_at'];
            onServed(at is String ? DateTime.tryParse(at)?.toLocal() : null);
          },
        )
        .subscribe();
  }

  /// Watch every meal served in this mess today, for the live count.
  ///
  /// The same socket as [watch], pointed at the tenant rather than one student.
  /// RLS decides what arrives — `attendance_read_tenant` lets staff see their
  /// own mess's rows and nobody else's — so the filter below is bandwidth, not
  /// a security boundary.
  Future<void> watchTenant({
    required String accessToken,
    required String serviceDate,
    required void Function() onServed,
  }) async {
    await ensureRealtimeReady();
    await stop();

    final client = Supabase.instance.client;
    client.realtime.setAuth(accessToken);

    _channel = client
        .channel('counter-attendance:$serviceDate')
        .onPostgresChanges(
          event: PostgresChangeEvent.insert,
          schema: 'public',
          table: 'attendance',
          callback: (payload) {
            if (payload.newRecord['service_date'] != serviceDate) return;
            onServed();
          },
        )
        .subscribe();
  }

  Future<void> stop() async {
    final channel = _channel;
    _channel = null;
    // Guarded on `_initialising`: `stop` runs from `dispose`, which can fire on
    // a screen the user left before any socket was ever opened.
    if (channel != null && _initialising != null) {
      await Supabase.instance.client.removeChannel(channel);
    }
  }
}

/// Initialise the Supabase client, **lazily**.
///
/// This used to run in `main()` before `runApp`, which meant every cold start
/// paid for it before a single pixel was drawn — on a screen that does not need
/// it. Realtime matters in exactly two places, both of them several taps in: a
/// student revealing their meal code, and staff opening live counts. Neither is
/// the first thing anyone sees, so the cost belongs there rather than in front
/// of the login form.
///
/// Idempotent, because both callers may reach it and either may be first.
///
/// `authOptions` deliberately keeps no session: this client is a socket, not an
/// identity. Sessions are ours, held in secure storage and refreshed through
/// `/api/auth/refresh`, and letting a second library persist its own copy would
/// mean two things believing they own the session.
Future<void>? _initialising;

Future<void> ensureRealtimeReady() {
  return _initialising ??= Supabase.initialize(
    url: AppConfig.supabaseUrl,
    // `publishableKey`, not the deprecated `anonKey` — and the value genuinely
    // is an `sb_publishable_...` key, Supabase's current public-client format.
    publishableKey: AppConfig.supabaseAnonKey,
    authOptions: const FlutterAuthClientOptions(autoRefreshToken: false),
  ).then((_) {});
}
