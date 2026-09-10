/// Entrance motion.
///
/// The difference between an app that looks assembled and one that feels built.
/// Content arriving with a short rise and fade reads as deliberate; content that
/// simply appears reads as a screenshot.
///
/// Three rules keep it from becoming irritating, which matters more here than
/// in most apps because staff use this standing up with a queue:
///
///  1. **Short.** 240ms, and the stagger tops out quickly. Anything longer is
///     something to wait through rather than something to enjoy.
///  2. **Small.** A 10px rise. Big travel is a distraction at a counter.
///  3. **Once.** Entry only, never on rebuild — a list that re-animates every
///     time a number changes is unusable.
///
/// Honours the platform's reduce-motion setting: for someone who has asked the
/// OS for less animation, this renders instantly and does nothing.
library;

import 'package:flutter/material.dart';

import 'tokens.dart';

/// Fades and rises its child once, when first built.
class FadeInUp extends StatefulWidget {
  const FadeInUp({super.key, required this.child, this.delay = Duration.zero});

  final Widget child;
  final Duration delay;

  @override
  State<FadeInUp> createState() => _FadeInUpState();
}

class _FadeInUpState extends State<FadeInUp>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: Motion.normal,
  );

  @override
  void initState() {
    super.initState();
    if (widget.delay == Duration.zero) {
      _controller.forward();
    } else {
      Future.delayed(widget.delay, () {
        // The screen may be gone before the delay elapses — a student tapping
        // through tabs quickly will do exactly that.
        if (mounted) _controller.forward();
      });
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Someone who asked the OS for less animation gets none, and gets their
    // content immediately rather than after a delay they did not consent to.
    if (MediaQuery.disableAnimationsOf(context)) return widget.child;

    final curved = CurvedAnimation(parent: _controller, curve: Motion.curve);

    return FadeTransition(
      opacity: curved,
      child: AnimatedBuilder(
        animation: curved,
        builder: (context, child) => Transform.translate(
          offset: Offset(0, 10 * (1 - curved.value)),
          child: child,
        ),
        child: widget.child,
      ),
    );
  }
}

/// Staggers a list's children in, one shortly after the next.
///
/// The stagger stops compounding after a handful of rows: on a long list the
/// twentieth item would otherwise arrive a second late, and a student scrolling
/// fast would out-run it.
List<Widget> staggered(List<Widget> children, {int maxStaggered = 6}) => [
  for (var i = 0; i < children.length; i++)
    FadeInUp(
      delay: Duration(milliseconds: 40 * (i < maxStaggered ? i : maxStaggered)),
      child: children[i],
    ),
];
