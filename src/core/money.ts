/**
 * Money (architecture doc §2.3).
 *
 * Money is **integer paise, always**. Never float, never rupees, never a
 * `numeric` column read as a JS number. `0.1 + 0.2 !== 0.3` is not an academic
 * curiosity when you are dividing a ₹4,000 plan across 60 meals and issuing
 * credits against the result: the drift compounds silently and shows up months
 * later as a balance nobody can reconcile.
 *
 * Formatting to rupees happens **only** at the render boundary.
 */

/** An amount in integer paise. 100 paise = ₹1. */
export type Paise = number & { readonly __brand: "Paise" };

export function toPaise(value: number): Paise {
  if (!Number.isInteger(value)) {
    throw new RangeError(`Money must be integer paise, received ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Money amount exceeds safe integer range: ${value}`);
  }
  return value as Paise;
}

/** Parses a rupee-denominated input (e.g. an admin typing "4000.50"). */
export function rupeesToPaise(rupees: number): Paise {
  // Rounding before the integer check absorbs the float representation error
  // inherent in a decimal rupee input; the result is exact from here on.
  return toPaise(Math.round(rupees * 100));
}

export const ZERO_PAISE = 0 as Paise;

export function addPaise(a: Paise, b: Paise): Paise {
  return toPaise(a + b);
}

export function subtractPaise(a: Paise, b: Paise): Paise {
  return toPaise(a - b);
}

export function multiplyPaise(amount: Paise, factor: number): Paise {
  if (!Number.isInteger(factor)) {
    throw new RangeError(`Money may only be multiplied by an integer, received ${factor}`);
  }
  return toPaise(amount * factor);
}

/** Clamps at zero. Credits must never drive an invoice total negative (§7.3). */
export function clampToZero(amount: Paise): Paise {
  return amount < 0 ? ZERO_PAISE : amount;
}

/**
 * Per-meal rate derived from a plan price (§7.1).
 *
 *   perMealPaise = floor(planPricePaise / totalMealsInPeriod)
 *
 * `floor`, deliberately. The rounding remainder stays with the mess, never with
 * the student, so total credits can never exceed what was actually paid. That
 * invariant is what keeps a mess-cut refund from quietly costing the owner more
 * than the subscription brought in — it is tested explicitly.
 */
export function perMealPaise(planPricePaise: Paise, totalMealsInPeriod: number): Paise {
  if (!Number.isInteger(totalMealsInPeriod) || totalMealsInPeriod <= 0) {
    throw new RangeError(
      `totalMealsInPeriod must be a positive integer, received ${totalMealsInPeriod}`,
    );
  }
  return toPaise(Math.floor(planPricePaise / totalMealsInPeriod));
}

/** The remainder the mess keeps after the per-meal split. Always ≥ 0. */
export function perMealRemainderPaise(planPricePaise: Paise, totalMealsInPeriod: number): Paise {
  const rate = perMealPaise(planPricePaise, totalMealsInPeriod);
  return toPaise(planPricePaise - rate * totalMealsInPeriod);
}

/**
 * Splits an amount into `parts` shares that sum **exactly** to the original.
 * The final share absorbs the remainder, so no paise is created or destroyed.
 * Use where a total must be distributed without loss; use `perMealPaise` where
 * a rate is being derived and the remainder should stay with the mess.
 */
export function splitEvenly(total: Paise, parts: number): Paise[] {
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new RangeError(`parts must be a positive integer, received ${parts}`);
  }
  const base = Math.floor(total / parts);
  const shares = Array.from({ length: parts }, () => toPaise(base));
  const distributed = base * parts;
  shares[parts - 1] = toPaise(base + (total - distributed));
  return shares;
}

/**
 * Renders paise for display. The only place rupees exist.
 *
 * Uses the `en-IN` locale so amounts group the Indian way (₹1,00,000 rather
 * than ₹100,000) — getting this wrong is immediately visible to every user.
 */
export function formatPaise(amount: Paise, currency = "INR", locale = "en-IN"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount / 100);
}
