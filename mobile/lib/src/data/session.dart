/// The signed-in user, exactly as `GET /api/me` and `POST /api/auth/login`
/// describe them.
///
/// Mirrors `toSessionPayload` on the server, which deliberately omits
/// `tenantId`, `actorProfileId` and `studentId`. The app never needs them: every
/// endpoint rebuilds its own tenant context from the token, and an id the client
/// could send back is the multi-tenancy bug rule 8 exists to prevent. If a field
/// here ever needs one of those, the answer is a server-side change, not a
/// wider payload.
library;

enum UserRole {
  student,
  staff,
  admin,
  superAdmin;

  static UserRole fromWire(String value) => switch (value) {
    'STUDENT' => UserRole.student,
    'STAFF' => UserRole.staff,
    'ADMIN' => UserRole.admin,
    'SUPER_ADMIN' => UserRole.superAdmin,
    // Fail closed (rule 7): an unrecognised role is treated as the least
    // privileged one rather than waved through. A newer server that adds a role
    // must not be able to grant this build a shell it does not understand.
    _ => UserRole.student,
  };

  /// Admins operate a counter during a rush, and the audit trail records who
  /// did. This mirrors `ROLE_GATES` in the web proxy exactly.
  bool get usesStaffShell =>
      this == UserRole.staff ||
      this == UserRole.admin ||
      this == UserRole.superAdmin;
}

class Session {
  const Session({
    required this.role,
    required this.fullName,
    required this.mustChangePassword,
    required this.tenantSlug,
    required this.tenantName,
    required this.tenantLogoUrl,
    required this.timezone,
    required this.isStudent,
  });

  final UserRole role;
  final String fullName;

  /// Gates every screen until the user chooses their own password (D-02).
  final bool mustChangePassword;

  final String tenantSlug;

  /// The mess's own name. Shown throughout the app in place of ours — once
  /// somebody has signed in they are inside *their hostel's* app.
  final String tenantName;

  /// Route to the mess's logo, or null if it has not uploaded one, in which
  /// case its name stands in.
  final String? tenantLogoUrl;

  /// IANA zone of the **mess**, not the device. Every date rendered anywhere in
  /// the app derives from this — a student travelling, or a phone with its
  /// clock set wrong, must still see the mess's own service dates (rule 9).
  final String timezone;

  final bool isStudent;

  factory Session.fromJson(Map<String, dynamic> json) => Session(
    role: UserRole.fromWire(json['role'] as String? ?? 'STUDENT'),
    fullName: json['fullName'] as String? ?? '',
    mustChangePassword: json['mustChangePassword'] as bool? ?? false,
    tenantSlug: json['tenantSlug'] as String? ?? '',
    tenantName: json['tenantName'] as String? ?? '',
    tenantLogoUrl: json['tenantLogoUrl'] as String?,
    timezone: json['timezone'] as String? ?? 'Asia/Kolkata',
    isStudent: json['isStudent'] as bool? ?? false,
  );

  Session copyWith({bool? mustChangePassword}) => Session(
    role: role,
    fullName: fullName,
    mustChangePassword: mustChangePassword ?? this.mustChangePassword,
    tenantSlug: tenantSlug,
    tenantName: tenantName,
    tenantLogoUrl: tenantLogoUrl,
    timezone: timezone,
    isStudent: isStudent,
  );
}

/// The tokens themselves, kept apart from [Session] because they go to secure
/// storage while the session is only ever held in memory.
class AuthTokens {
  const AuthTokens({required this.accessToken, required this.refreshToken});

  final String accessToken;
  final String refreshToken;
}
