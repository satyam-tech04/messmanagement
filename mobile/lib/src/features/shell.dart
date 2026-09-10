/// The two shells, chosen by role at sign-in.
///
/// One binary serves students and counter staff. Which shell you get mirrors
/// `ROLE_GATES` in the web proxy exactly — including admins landing on the staff
/// shell, because they genuinely do operate a counter during a rush and the
/// audit trail records who did. Admin console work stays on the web.
///
/// The tabs are declared here and their screens land slice by slice. Each
/// unbuilt tab renders a designed empty state rather than a blank Container: a
/// screen that renders nothing is indistinguishable from one that is broken.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/session.dart';
import '../core/config.dart';
import '../design/async_view.dart';
import '../design/brand.dart';
import '../design/offline_banner.dart';
import '../design/theme.dart';
import '../design/tokens.dart';
import 'staff/counts_screen.dart';
import 'staff/sales_screen.dart';
import 'staff/scanner_screen.dart';
import 'student/menu_screen.dart';
import 'student/more_screen.dart';
import 'student/plan_screen.dart';
import 'student/qr_screen.dart';
import '../state/auth_controller.dart';
import '../state/theme_controller.dart';

class _Tab {
  const _Tab({
    required this.icon,
    required this.label,
    required this.title,
    required this.pending,
  });

  final IconData icon;
  final String label;
  final String title;

  /// What is not built yet. Null once the real screen lands.
  final String? pending;
}

const _studentTabs = <_Tab>[
  _Tab(
    icon: Icons.qr_code_2_rounded,
    label: 'My code',
    title: 'My meal code',
    pending: null,
  ),
  _Tab(
    icon: Icons.restaurant_menu_rounded,
    label: 'Menu',
    title: "Today's menu",
    pending: null,
  ),
  _Tab(
    icon: Icons.card_membership_rounded,
    label: 'Plan',
    title: 'My plan',
    pending: null,
  ),
  _Tab(
    icon: Icons.more_horiz_rounded,
    label: 'More',
    title: 'More',
    pending: null,
  ),
];

const _staffTabs = <_Tab>[
  _Tab(
    icon: Icons.qr_code_scanner_rounded,
    label: 'Scan',
    title: 'Scan meal codes',
    pending: null,
  ),
  _Tab(
    icon: Icons.edit_note_rounded,
    label: 'Manual',
    title: 'Manual entry',
    pending: null,
  ),
  _Tab(
    icon: Icons.groups_rounded,
    label: 'Counts',
    title: 'Live counts',
    pending: null,
  ),
  _Tab(
    icon: Icons.receipt_long_rounded,
    label: 'Sales',
    title: 'Counter sales',
    pending: null,
  ),
];

class AppShell extends ConsumerStatefulWidget {
  const AppShell({super.key, required this.session});

  final Session session;

  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> {
  int _index = 0;

  /// A built screen, or the designed placeholder for a tab whose slice has not
  /// landed. A blank body is indistinguishable from a broken one.
  Widget _screenFor(_Tab tab) {
    if (tab.pending != null) {
      return EmptyState(
        icon: tab.icon,
        title: tab.title,
        message: tab.pending!,
      );
    }
    return switch (tab.label) {
      'My code' => QrScreen(session: widget.session),
      'Menu' => const MenuScreen(),
      'Plan' => const PlanScreen(),
      'More' => const MoreScreen(),
      'Scan' => ScannerScreen(session: widget.session),
      // Manual entry is a sheet on the scanner, and also its own tab for a
      // counter whose camera has given up entirely.
      'Manual' => ScannerScreen(session: widget.session, manualOnly: true),
      'Counts' => CountsScreen(session: widget.session),
      'Sales' => const SalesScreen(),
      _ => EmptyState(icon: tab.icon, title: tab.title, message: ''),
    };
  }

  @override
  Widget build(BuildContext context) {
    final tabs = widget.session.role.usesStaffShell ? _staffTabs : _studentTabs;
    final tab = tabs[_index];

    return Scaffold(
      appBar: AppBar(
        titleSpacing: Space.lg,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            // The hostel's identity, not ours. Ours is on the store listing and
            // the login screen only.
            DefaultTextStyle.merge(
              style: context.texts.titleSmall ?? const TextStyle(),
              child: TenantMark(
                name: widget.session.tenantName,
                logoUrl: widget.session.tenantLogoUrl,
                baseUrl: AppConfig.apiBaseUrl,
                authHeader: {
                  'Authorization':
                      'Bearer ${ref.read(apiClientProvider).currentTokens?.accessToken ?? ''}',
                },
                size: 24,
              ),
            ),
            Text(
              tab.title,
              style: context.texts.bodySmall?.copyWith(
                color: context.colors.onSurfaceVariant,
              ),
            ),
          ],
        ),
        actions: [
          PopupMenuButton<String>(
            icon: const Icon(Icons.account_circle_outlined),
            tooltip: 'Account',
            onSelected: (value) {
              if (value == 'signOut') {
                ref.read(authControllerProvider.notifier).signOut();
                return;
              }
              final mode = ThemeMode.values.asNameMap()[value];
              if (mode != null) {
                ref.read(themeModeProvider.notifier).set(mode);
              }
            },
            itemBuilder: (context) {
              final current = ref.read(themeModeProvider);
              return [
                PopupMenuItem(
                  enabled: false,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(widget.session.fullName),
                      Text(
                        widget.session.tenantName,
                        style: context.texts.bodySmall,
                      ),
                    ],
                  ),
                ),
                const PopupMenuDivider(),
                // Appearance lives here rather than behind a settings screen:
                // it is the only preference the app has, and burying one switch
                // under a screen of its own helps nobody.
                for (final mode in ThemeMode.values)
                  PopupMenuItem(
                    value: mode.name,
                    child: Row(
                      children: [
                        Icon(themeModeIcon(mode), size: 18),
                        const SizedBox(width: Space.md),
                        Expanded(child: Text(themeModeLabel(mode))),
                        // A tick as well as the highlight — the selected item
                        // must be identifiable without relying on colour.
                        if (mode == current)
                          Icon(
                            Icons.check_rounded,
                            size: 18,
                            color: context.colors.primary,
                          ),
                      ],
                    ),
                  ),
                const PopupMenuDivider(),
                const PopupMenuItem(value: 'signOut', child: Text('Sign out')),
              ];
            },
          ),
        ],
      ),
      body: Column(
        children: [
          // Above the content, so it never covers what a screen is saying about
          // what it can still do while offline.
          const OfflineBanner(),
          Expanded(child: _screenFor(tab)),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: [
          for (final t in tabs)
            NavigationDestination(icon: Icon(t.icon), label: t.label),
        ],
      ),
    );
  }
}
