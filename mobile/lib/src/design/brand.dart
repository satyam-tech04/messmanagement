/// The CampusMeals mark.
///
/// One widget so every place the logo appears — login, splash, an empty state —
/// scales the same asset the launcher icon is built from, rather than each
/// screen picking a Material glyph that happens to look food-ish.
library;

import 'package:flutter/material.dart';
import '../core/app_info.dart';

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
    semanticLabel: AppInfo.name,
    // A missing asset must not take down the login screen — it is decoration,
    // and the words beneath it already say what this is.
    errorBuilder: (context, _, _) => Icon(
      Icons.restaurant_rounded,
      size: size * 0.7,
      color: Theme.of(context).colorScheme.primary,
    ),
  );
}

/// The signed-in mess's own mark, falling back to its name.
///
/// After login the app belongs to the hostel, not to us: our mark stays on the
/// store listing and the login screen — the two places a person has not yet
/// identified which mess they are in. Everywhere else shows theirs.
///
/// The **theme** does not follow the tenant, only the identity does. A
/// per-hostel palette would mean re-verifying every contrast pairing for every
/// customer, and one would eventually pick something unreadable on a counter
/// tablet under kitchen lighting.
class TenantMark extends StatelessWidget {
  const TenantMark({
    super.key,
    required this.name,
    required this.logoUrl,
    required this.baseUrl,
    required this.authHeader,
    this.size = 28,
  });

  final String name;
  final String? logoUrl;
  final String baseUrl;

  /// The logo route is session-scoped, so the image request carries the same
  /// bearer token every other call does.
  final Map<String, String> authHeader;

  final double size;

  @override
  Widget build(BuildContext context) {
    final url = logoUrl;

    if (url == null) {
      // No logo uploaded. The name alone is a perfectly good identity, and an
      // invented monogram would be worse than the thing it stands in for.
      return Text(
        name,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontWeight: FontWeight.w700),
      );
    }

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(size / 4),
          child: Image.network(
            '$baseUrl$url',
            headers: authHeader,
            width: size,
            height: size,
            fit: BoxFit.contain,
            // A logo that will not load must not blank the identity — fall back
            // to exactly what a mess without one shows.
            errorBuilder: (context, _, _) => const SizedBox.shrink(),
          ),
        ),
        const SizedBox(width: 8),
        Flexible(
          child: Text(
            name,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
        ),
      ],
    );
  }
}
