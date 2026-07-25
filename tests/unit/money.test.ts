import { describe, it, expect } from "vitest";
import {
  addPaise,
  clampToZero,
  formatPaise,
  multiplyPaise,
  perMealPaise,
  perMealRemainderPaise,
  rupeesToPaise,
  splitEvenly,
  subtractPaise,
  toPaise,
  ZERO_PAISE,
} from "@/core/money";

describe("paise construction", () => {
  it("accepts integers", () => {
    expect(toPaise(0)).toBe(0);
    expect(toPaise(400000)).toBe(400000);
    expect(toPaise(-500)).toBe(-500); // debits are legitimate
  });

  it("rejects fractional amounts — the whole point of integer paise", () => {
    expect(() => toPaise(100.5)).toThrow(RangeError);
    expect(() => toPaise(0.1 + 0.2)).toThrow(RangeError);
  });

  it("rejects amounts beyond safe integer range", () => {
    expect(() => toPaise(Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
  });

  it("converts rupee input without float drift", () => {
    expect(rupeesToPaise(4000)).toBe(400000);
    expect(rupeesToPaise(4000.5)).toBe(400050);
    expect(rupeesToPaise(0.1)).toBe(10);
    // 19.99 * 100 is 1998.9999999999998 in IEEE754; rounding must absorb it.
    expect(rupeesToPaise(19.99)).toBe(1999);
  });
});

describe("arithmetic", () => {
  it("adds, subtracts and multiplies", () => {
    expect(addPaise(toPaise(400000), toPaise(5000))).toBe(405000);
    expect(subtractPaise(toPaise(400000), toPaise(5000))).toBe(395000);
    expect(multiplyPaise(toPaise(6666), 5)).toBe(33330);
  });

  it("refuses fractional multipliers", () => {
    expect(() => multiplyPaise(toPaise(100), 1.5)).toThrow(RangeError);
  });

  it("clamps negatives to zero for invoice totals", () => {
    expect(clampToZero(toPaise(-5000))).toBe(ZERO_PAISE);
    expect(clampToZero(toPaise(5000))).toBe(5000);
  });
});

describe("perMealPaise — §7.1 remainder invariant", () => {
  it("floors the division", () => {
    // ₹4,000 across 30 days x 2 meals = 60 meals -> 6666.67 paise -> 6666.
    expect(perMealPaise(toPaise(400000), 60)).toBe(6666);
  });

  it("divides exactly when it can", () => {
    expect(perMealPaise(toPaise(400000), 50)).toBe(8000);
    expect(perMealRemainderPaise(toPaise(400000), 50)).toBe(0);
  });

  it("leaves the remainder with the mess, never the student", () => {
    const planPrice = toPaise(400000);
    const meals = 60;
    const rate = perMealPaise(planPrice, meals);
    const remainder = perMealRemainderPaise(planPrice, meals);

    expect(remainder).toBe(40); // 400000 - 6666*60
    expect(remainder).toBeGreaterThanOrEqual(0);
    expect(rate * meals + remainder).toBe(planPrice);
  });

  it("guarantees total credits can never exceed the amount paid", () => {
    // The invariant that actually protects the owner: crediting back every
    // single meal in the period must still not exceed the plan price.
    const cases: Array<[number, number]> = [
      [400000, 60],
      [400000, 62],
      [1200000, 182],
      [299900, 31],
      [1, 7],
      [999999, 179],
    ];

    for (const [price, meals] of cases) {
      const planPrice = toPaise(price);
      const maxCredit = perMealPaise(planPrice, meals) * meals;
      expect(maxCredit).toBeLessThanOrEqual(planPrice);
    }
  });

  it("rejects a non-positive meal count", () => {
    expect(() => perMealPaise(toPaise(400000), 0)).toThrow(RangeError);
    expect(() => perMealPaise(toPaise(400000), -5)).toThrow(RangeError);
    expect(() => perMealPaise(toPaise(400000), 1.5)).toThrow(RangeError);
  });
});

describe("splitEvenly — no paise created or destroyed", () => {
  it("sums exactly to the original for indivisible amounts", () => {
    const shares = splitEvenly(toPaise(100), 3);
    expect(shares).toEqual([33, 33, 34]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("splits evenly when it divides", () => {
    expect(splitEvenly(toPaise(400000), 4)).toEqual([100000, 100000, 100000, 100000]);
  });

  it("handles a single share", () => {
    expect(splitEvenly(toPaise(777), 1)).toEqual([777]);
  });

  it("conserves the total across many shapes", () => {
    for (const total of [1, 7, 100, 99999, 400000]) {
      for (const parts of [1, 2, 3, 7, 13, 60]) {
        const sum = splitEvenly(toPaise(total), parts).reduce((a, b) => a + b, 0);
        expect(sum).toBe(total);
      }
    }
  });

  it("rejects a non-positive part count", () => {
    expect(() => splitEvenly(toPaise(100), 0)).toThrow(RangeError);
  });
});

describe("formatPaise — render boundary only", () => {
  it("formats rupees with Indian digit grouping", () => {
    // en-IN groups as 1,00,000 not 100,000. Getting this wrong is visible to
    // every user on every screen.
    expect(formatPaise(toPaise(10000000))).toBe("₹1,00,000.00");
    expect(formatPaise(toPaise(400000))).toBe("₹4,000.00");
  });

  it("always shows two decimal places", () => {
    expect(formatPaise(toPaise(6666))).toBe("₹66.66");
    expect(formatPaise(toPaise(100))).toBe("₹1.00");
    expect(formatPaise(ZERO_PAISE)).toBe("₹0.00");
  });

  it("formats negative amounts", () => {
    expect(formatPaise(toPaise(-400000))).toBe("-₹4,000.00");
  });
});
