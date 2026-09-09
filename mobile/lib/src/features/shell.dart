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
import '../design/async_view.dart';
import 'staff/scanner_screen.dart';
import 'student/menu_screen.dart';
import 'student/more_screen.dart';
import 'student/plan_screen.dart';
import 'student/qr_screen.dart';
import '../state/auth_controller.dart';

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
    pending: 'The audited manual fallback is coming soon.',
  ),
  _Tab(
    icon: Icons.groups_rounded,
    label: 'Counts',
    title: 'Live counts',
    pending: 'Projected and served counts are coming soon.',
  ),
  _Tab(
    icon: Icons.receipt_long_rounded,
    label: 'Sales',
    title: 'Counter sales',
    pending: 'Counter billing is coming soon.',
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
      _ => EmptyState(icon: tab.icon, title: tab.title, message: ''),
    };
  }

  @override
  Widget build(BuildContext context) {
    final tabs = widget.session.role.usesStaffShell ? _staffTabs : _studentTabs;
    final tab = tabs[_index];

    return Scaffold(
      appBar: AppBar(
        title: Text(tab.title),
        actions: [
          PopupMenuButton<String>(
            icon: const Icon(Icons.account_circle_outlined),
            tooltip: 'Account',
            onSelected: (value) {
              if (value == 'signOut') {
                ref.read(authControllerProvider.notifier).signOut();
              }
            },
            itemBuilder: (context) => [
              PopupMenuItem(
                enabled: false,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(widget.session.fullName),
                    Text(
                      widget.session.tenantSlug,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
              const PopupMenuDivider(),
              const PopupMenuItem(value: 'signOut', child: Text('Sign out')),
            ],
          ),
        ],
      ),
      body: _screenFor(tab),
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
