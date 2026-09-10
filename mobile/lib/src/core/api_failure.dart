/// What went wrong, as a domain code rather than an HTTP status.
///
/// The server answers denials with a `code`, deliberately, and the QR verify
/// endpoint even returns HTTP 200 for a refusal so the counter's offline queue
/// never retries a legitimate "no" forever. `SUBSCRIPTION_PAUSED` currently
/// comes back as a 400 through a default branch. **So the status line is not
/// reliable and the app must key on `code`.**
///
/// Every denial the student can hit is a designed screen, not a toast: a
/// blocked student needs to be told to see the office, not shown a red banner
/// that disappears.
library;

class ApiFailure implements Exception {
  const ApiFailure({
    required this.code,
    required this.message,
    this.status,
    this.details,
  });

  /// The domain code. Switch on this, never on [status].
  final String code;

  /// Server-authored and safe to show. The server deliberately returns one
  /// identical message for every bad-credential case, so echoing it verbatim is
  /// what keeps the app from leaking which accounts exist.
  final String message;

  final int? status;
  final Map<String, dynamic>? details;

  /// No session, or one that could not be verified.
  bool get isUnauthenticated => code == 'UNAUTHENTICATED';

  /// The user still owes the forced first-password change; every endpoint but
  /// the change itself refuses until they do.
  bool get needsPasswordChange => code == 'PASSWORD_CHANGE_REQUIRED';

  /// The request never reached the server. Distinct from a refusal: worth
  /// retrying, and at the counter it is what the offline queue exists for.
  bool get isOffline => code == 'NETWORK_ERROR' || code == 'TIMEOUT';

  /// The server answered, but with a fault of its own rather than a decision.
  ///
  /// Separated from [isOffline] because the advice differs: waiting helps here,
  /// and moving somewhere with signal does not.
  bool get isServerFault =>
      code == 'INFRASTRUCTURE_ERROR' || (status != null && status! >= 500);

  /// Worth trying again unprompted. A refusal never is — the server has decided,
  /// and repeating the question does not change the answer.
  bool get isTransient => isOffline || isServerFault || code == 'RATE_LIMITED';

  @override
  String toString() => 'ApiFailure($code): $message';
}
