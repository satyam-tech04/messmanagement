/// The MessOS mark.
///
/// One widget so every place the logo appears — login, splash, an empty state —
/// scales the same asset the launcher icon is built from, rather than each
/// screen picking a Material glyph that happens to look food-ish.
library;

import 'package:flutter/material.dart';

class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.size = 72});

  final double size;

  @override
  Widget build(BuildContext context) => Image.asset(
    'assets/brand/mark.png',
    width: size,
    // The mark is wider than it is tall, so height follows from the asset
    // rather than being forced square and squashing the cloud.
    fit: BoxFit.contain,
    semanticLabel: 'MessOS',
    // A missing asset must not take down the login screen — it is decoration,
    // and the words beneath it already say what this is.
    errorBuilder: (context, _, _) => Icon(
      Icons.restaurant_rounded,
      size: size * 0.7,
      color: Theme.of(context).colorScheme.primary,
    ),
  );
}
