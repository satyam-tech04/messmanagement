/// The public legal and help pages, as the account menu lists them.
///
/// Apple requires the privacy policy and account deletion to be reachable from
/// inside the app, not only from the store listing. The paths mirror the web's
/// `LEGAL_PAGES` in `src/lib/site.ts`, and `tests/unit/app-identity.test.ts`
/// fails if either side renames one.
library;

import 'package:flutter/material.dart';

import 'app_info.dart';

class LegalLink {
  const LegalLink(this.label, this.path, this.icon);

  final String label;
  final String path;
  final IconData icon;

  Uri get uri => Uri.parse('${AppInfo.website}$path');
}

class LegalLinks {
  const LegalLinks._();

  static const LegalLink privacy = LegalLink(
    'Privacy policy',
    '/privacy',
    Icons.privacy_tip_outlined,
  );
  static const LegalLink terms = LegalLink(
    'Terms & conditions',
    '/terms',
    Icons.description_outlined,
  );

  /// Also opened from the in-app deletion screen, for the full wording.
  static const LegalLink deleteAccount = LegalLink(
    'Delete account',
    '/delete-account',
    Icons.person_remove_outlined,
  );
  static const LegalLink support = LegalLink(
    'Help & support',
    '/support',
    Icons.help_outline_rounded,
  );

  static const List<LegalLink> all = [privacy, terms, deleteAccount, support];
}
