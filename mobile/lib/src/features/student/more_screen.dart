/// Absences and feedback, behind one tab.
///
/// Both are feature-flagged per mess and both ship **off**, so a fixed pair of
/// sub-tabs would advertise things half the hostels do not have. The tabs are
/// built from what `/api/me` says is enabled, and when nothing is, the screen
/// says so rather than showing an empty shell.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../design/async_view.dart';
import '../../state/student_providers.dart';
import 'absences_screen.dart';
import 'feedback_screen.dart';

class MoreScreen extends ConsumerWidget {
  const MoreScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Derived from the same endpoints the screens use, so a tab can never
    // appear for something the mess has switched off.
    final absences = ref.watch(studentAbsencesProvider);
    final feedback = ref.watch(studentFeedbackProvider);

    final absencesOn = absences.asData?.value.enabled ?? false;
    final feedbackOn = feedback.asData?.value.enabled ?? false;

    // Still deciding. Show neither rather than flashing a tab bar that is about
    // to change shape under the reader's thumb.
    if (absences.isLoading || feedback.isLoading) {
      return const Padding(
        padding: EdgeInsets.all(16),
        child: Column(
          children: [
            Skeleton(height: 48, radius: 12),
            SizedBox(height: 16),
            Skeleton(height: 96, radius: 12),
          ],
        ),
      );
    }

    if (!absencesOn && !feedbackOn) {
      return const EmptyState(
        icon: Icons.more_horiz_rounded,
        title: 'Nothing else here yet',
        message:
            'Your mess has not switched on meal skips or feedback. Everything you '
            'need is on the other tabs.',
      );
    }

    if (absencesOn && !feedbackOn) return const AbsencesScreen();
    if (feedbackOn && !absencesOn) return const FeedbackScreen();

    return DefaultTabController(
      length: 2,
      child: Column(
        children: [
          const TabBar(
            tabs: [
              Tab(text: 'Absences'),
              Tab(text: 'Feedback'),
            ],
          ),
          const Expanded(
            child: TabBarView(
              children: [AbsencesScreen(), FeedbackScreen()],
            ),
          ),
        ],
      ),
    );
  }
}
