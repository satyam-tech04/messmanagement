/// Aurora Depth — the ambient backdrop and the gradient accents, mirroring
/// `src/components/aurora-backdrop.tsx` on the web.
///
/// Decorative only: excluded from semantics, never hit-testable. The drift
/// stops when the device asks for reduced motion, and the backdrop is kept
/// faint behind content — a QR and a counter verdict must never compete with a
/// glow for contrast.
library;

import 'package:flutter/material.dart';

import 'theme.dart';

class AuroraBackground extends StatefulWidget {
  const AuroraBackground({super.key, required this.child, this.subtle = false});

  final Widget child;

  /// For working screens (the shell). Full strength is for sign-in.
  final bool subtle;

  @override
  State<AuroraBackground> createState() => _AuroraBackgroundState();
}

class _AuroraBackgroundState extends State<AuroraBackground>
    with SingleTickerProviderStateMixin {
  late final AnimationController _drift = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 18),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.of(context).disableAnimations) {
      _drift.stop();
    } else if (!_drift.isAnimating) {
      _drift.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _drift.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final aurora = context.aurora;
    final opacity = widget.subtle ? 0.55 : 1.0;

    return Stack(
      fit: StackFit.expand,
      children: [
        ColoredBox(color: Theme.of(context).scaffoldBackgroundColor),
        ExcludeSemantics(
          child: IgnorePointer(
            child: Opacity(
              opacity: opacity,
              child: AnimatedBuilder(
                animation: _drift,
                builder: (context, _) {
                  final t = Curves.easeInOut.transform(_drift.value);
                  return LayoutBuilder(
                    builder: (context, box) {
                      final w = box.maxWidth;
                      final h = box.maxHeight;
                      return Stack(
                        children: [
                          _Orb(
                            color: aurora.orb1,
                            size: w * 1.2,
                            left: -w * 0.35,
                            top: -h * 0.18 - 24 * t,
                          ),
                          _Orb(
                            color: aurora.orb2,
                            size: w * 1.05,
                            left: w * 0.35,
                            top: h * 0.3 + 24 * t,
                          ),
                          if (!widget.subtle)
                            _Orb(
                              color: aurora.orb3,
                              size: w * 0.95,
                              left: -w * 0.1,
                              top: h * 0.72 - 18 * t,
                            ),
                          Positioned.fill(
                            child: CustomPaint(
                              painter: _GridPainter(aurora.grid),
                            ),
                          ),
                        ],
                      );
                    },
                  );
                },
              ),
            ),
          ),
        ),
        widget.child,
      ],
    );
  }
}

class _Orb extends StatelessWidget {
  const _Orb({
    required this.color,
    required this.size,
    required this.left,
    required this.top,
  });

  final Color color;
  final double size;
  final double left;
  final double top;

  @override
  Widget build(BuildContext context) => Positioned(
    left: left,
    top: top,
    width: size,
    height: size,
    child: DecoratedBox(
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: RadialGradient(
          colors: [color, color.withValues(alpha: 0)],
          stops: const [0, 0.62],
        ),
      ),
    ),
  );
}

/// The faint 80px grid, fading out towards the bottom like the web's mask.
class _GridPainter extends CustomPainter {
  _GridPainter(this.color);

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    const step = 56.0;
    final fadeEnd = size.height * 0.6;
    for (double y = 0; y <= fadeEnd; y += step) {
      final paint = Paint()
        ..color = color.withValues(alpha: color.a * (1 - y / fadeEnd))
        ..strokeWidth = 1;
      canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
    }
    for (double x = 0; x <= size.width; x += step) {
      final paint = Paint()
        ..shader = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [color, color.withValues(alpha: 0)],
        ).createShader(Rect.fromLTWH(x, 0, 1, fadeEnd))
        ..strokeWidth = 1;
      canvas.drawLine(Offset(x, 0), Offset(x, fadeEnd), paint);
    }
  }

  @override
  bool shouldRepaint(_GridPainter old) => old.color != color;
}

/// Text painted with the aurora gradient — for a headline's accent words.
class AuroraGradientText extends StatelessWidget {
  const AuroraGradientText(this.text, {super.key, this.style, this.textAlign});

  final String text;
  final TextStyle? style;
  final TextAlign? textAlign;

  @override
  Widget build(BuildContext context) => ShaderMask(
    blendMode: BlendMode.srcIn,
    shaderCallback: (bounds) => context.aurora.gradient.createShader(bounds),
    child: Text(text, style: style, textAlign: textAlign),
  );
}

/// The mono eyebrow above a title, with an optional live pulse dot.
class AuroraEyebrow extends StatelessWidget {
  const AuroraEyebrow(this.text, {super.key, this.pulse = false});

  final String text;
  final bool pulse;

  @override
  Widget build(BuildContext context) {
    final aurora = context.aurora;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (pulse) ...[
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(
              color: aurora.accent1,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 8),
        ],
        Text(
          text.toUpperCase(),
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            letterSpacing: 2,
            color: aurora.accent3,
          ),
        ),
      ],
    );
  }
}
