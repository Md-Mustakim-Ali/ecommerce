import { mean, standardDeviation, standardError } from "./descriptive";
import { normalQuantile, studentTCdf, studentTQuantile } from "./distributions";

/**
 * Interval estimation and hypothesis tests.
 *
 * Every headline number on an analytics screen is an estimate from a sample.
 * "Conversion is 3.1%" from 40 sessions and from 40,000 sessions are different
 * claims, and a dashboard that renders them identically is lying by omission.
 * These functions exist so it does not have to.
 */

export type Interval = { estimate: number; low: number; high: number };

/**
 * Confidence interval for a mean, using the t-distribution.
 *
 * t rather than z, always. The normal interval is only correct when the
 * population standard deviation is known, which it never is here, and it is
 * visibly too narrow below about n=30 — precisely the sample sizes a new store
 * has.
 */
export function meanInterval(
  values: readonly number[],
  confidence = 0.95,
): Interval {
  const n = values.length;
  const estimate = mean(values);

  if (n < 2) return { estimate, low: Number.NaN, high: Number.NaN };

  const se = standardError(values);
  const t = studentTQuantile(1 - (1 - confidence) / 2, n - 1);
  return { estimate, low: estimate - t * se, high: estimate + t * se };
}

/**
 * Wilson score interval for a proportion.
 *
 * Not the normal approximation `p ± z·sqrt(p(1-p)/n)`, which is indefensible at
 * the edges: with 0 successes it produces the interval [0, 0], claiming
 * certainty from no evidence, and it can extend below 0 or above 1. Wilson is
 * bounded, behaves at p=0 and p=1, and is accurate at small n.
 */
export function proportionInterval(
  successes: number,
  trials: number,
  confidence = 0.95,
): Interval {
  if (trials <= 0) return { estimate: Number.NaN, low: 0, high: 1 };

  const p = successes / trials;
  const z = normalQuantile(1 - (1 - confidence) / 2);
  const z2 = z * z;

  const denominator = 1 + z2 / trials;
  const centre = p + z2 / (2 * trials);
  const spread =
    z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials));

  return {
    estimate: p,
    low: Math.max(0, (centre - spread) / denominator),
    high: Math.min(1, (centre + spread) / denominator),
  };
}

/**
 * Welch's two-sample t-test.
 *
 * Welch rather than Student's: it does not assume equal variances, and two
 * groups being compared on a dashboard — this month against last, one store
 * against another — almost never have them. Student's t with unequal variances
 * and unequal n is anti-conservative, which means false "significant" results
 * in exactly the direction that gets acted on.
 */
export function welchTTest(
  a: readonly number[],
  b: readonly number[],
): {
  t: number;
  df: number;
  pValue: number;
  meanDifference: number;
  significant: (alpha?: number) => boolean;
} {
  const na = a.length;
  const nb = b.length;

  if (na < 2 || nb < 2) {
    return {
      t: Number.NaN,
      df: Number.NaN,
      pValue: Number.NaN,
      meanDifference: mean(a) - mean(b),
      significant: () => false,
    };
  }

  const va = standardDeviation(a) ** 2;
  const vb = standardDeviation(b) ** 2;
  const sa = va / na;
  const sb = vb / nb;

  const meanDifference = mean(a) - mean(b);
  const denominator = Math.sqrt(sa + sb);

  if (denominator === 0) {
    return {
      t: 0,
      df: na + nb - 2,
      pValue: 1,
      meanDifference,
      significant: () => false,
    };
  }

  const t = meanDifference / denominator;
  // Welch–Satterthwaite degrees of freedom.
  const df = (sa + sb) ** 2 / (sa ** 2 / (na - 1) + sb ** 2 / (nb - 1));

  const pValue = 2 * (1 - studentTCdf(Math.abs(t), df));

  return {
    t,
    df,
    pValue,
    meanDifference,
    significant: (alpha = 0.05) => pValue < alpha,
  };
}

/**
 * Two-proportion z-test, for comparing rates.
 *
 * Uses the pooled proportion for the standard error, which is the correct form
 * under the null hypothesis that the two rates are equal.
 */
export function twoProportionTest(
  a: { successes: number; trials: number },
  b: { successes: number; trials: number },
): { z: number; pValue: number; difference: number } {
  if (a.trials === 0 || b.trials === 0) {
    return { z: Number.NaN, pValue: Number.NaN, difference: Number.NaN };
  }

  const pa = a.successes / a.trials;
  const pb = b.successes / b.trials;
  const pooled = (a.successes + b.successes) / (a.trials + b.trials);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.trials + 1 / b.trials));

  if (se === 0) return { z: 0, pValue: 1, difference: pa - pb };

  const z = (pa - pb) / se;
  // Normal approximation is fine here: the pooled counts on a marketplace are
  // large, and this is a two-sided tail.
  const pValue = 2 * (1 - normalCdfLocal(Math.abs(z)));

  return { z, pValue, difference: pa - pb };
}

// Local copy so this module does not re-export the distribution surface.
function normalCdfLocal(z: number): number {
  // 0.5 * erfc(-z/sqrt2), expressed through the same erf used elsewhere.
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * Bayesian shrinkage for a rating, toward the platform mean.
 *
 * A single five-star review is not evidence that a product is better than one
 * averaging 4.7 over 900 reviews, but a raw mean says it is, and every
 * "top rated" list that sorts on the raw mean is topped by products with one
 * review. This is the standard `(C·m + Σx) / (C + n)` correction: `C` is how
 * many reviews of evidence it takes to move away from the prior.
 */
export function bayesianRating(input: {
  sum: number;
  count: number;
  priorMean: number;
  priorWeight?: number;
}): number {
  const weight = input.priorWeight ?? 10;
  if (input.count === 0) return input.priorMean;
  return (weight * input.priorMean + input.sum) / (weight + input.count);
}

/**
 * Wilson lower bound on the proportion of positive ratings.
 *
 * The other defensible way to rank by rating: score by the lower end of the
 * interval, so a product only outranks another once there is enough evidence
 * to be confident it deserves to.
 */
export function wilsonLowerBound(
  positive: number,
  total: number,
  confidence = 0.95,
): number {
  if (total === 0) return 0;
  return proportionInterval(positive, total, confidence).low;
}
