/**
 * Concentration and inequality measures.
 *
 * The question these answer is "how much of this total comes from how few of
 * these things". For a seller it is revenue concentration across products —
 * how exposed the business is if one listing stops selling. For the platform
 * it is revenue across stores, which is the same risk one level up.
 *
 * A dashboard that only shows a top-10 list cannot answer it. Ten rows look
 * much the same whether they are 20% of revenue or 95% of it.
 */

/**
 * Gini coefficient: 0 is perfectly even, 1 is everything from one source.
 *
 * Computed from the sorted values by the covariance form, which is O(n log n)
 * rather than the O(n²) pairwise-difference definition.
 */
export function gini(values: readonly number[]): number {
  const positive = values.filter((v) => v > 0);
  const n = positive.length;
  if (n === 0) return Number.NaN;
  if (n === 1) return 0;

  const sorted = [...positive].sort((a, b) => a - b);
  const total = sorted.reduce((sum, v) => sum + v, 0);
  if (total === 0) return 0;

  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (i + 1) * sorted[i];

  return (2 * weighted) / (n * total) - (n + 1) / n;
}

/**
 * Lorenz curve points, for plotting concentration directly.
 *
 * Returns cumulative share of population against cumulative share of value,
 * starting at (0,0). The diagonal is perfect equality; the area between it and
 * the curve is half the Gini.
 */
export function lorenzCurve(
  values: readonly number[],
): { population: number; value: number }[] {
  const positive = values.filter((v) => v > 0).sort((a, b) => a - b);
  const n = positive.length;
  if (n === 0) return [{ population: 0, value: 0 }];

  const total = positive.reduce((sum, v) => sum + v, 0);
  const points = [{ population: 0, value: 0 }];

  let cumulative = 0;
  positive.forEach((value, index) => {
    cumulative += value;
    points.push({
      population: (index + 1) / n,
      value: total === 0 ? 0 : cumulative / total,
    });
  });

  return points;
}

/**
 * Herfindahl–Hirschman index: the sum of squared market shares.
 *
 * Ranges from 1/n (even) to 1 (monopoly). Competition authorities read it on a
 * 0–10,000 scale; this returns the 0–1 form, so multiply by 10,000 to compare
 * against the usual thresholds.
 *
 * Reported alongside Gini because they disagree usefully: Gini is insensitive
 * to how many participants there are, HHI is not, and a marketplace cares
 * about both.
 */
export function herfindahl(values: readonly number[]): number {
  const positive = values.filter((v) => v > 0);
  const total = positive.reduce((sum, v) => sum + v, 0);
  if (total === 0) return Number.NaN;

  return positive.reduce((sum, v) => sum + (v / total) ** 2, 0);
}

/** Effective number of participants: 1/HHI. Reads more naturally than HHI. */
export function effectiveCount(values: readonly number[]): number {
  const h = herfindahl(values);
  return Number.isFinite(h) && h > 0 ? 1 / h : Number.NaN;
}

/**
 * The share of total held by the top `fraction` of items, and the inverse:
 * what fraction of items produces `share` of the total.
 *
 * The second is the one people mean by "the 80/20 rule", and it is worth
 * computing rather than assuming — real catalogues are often closer to 90/10.
 */
export function paretoShare(
  values: readonly number[],
  fraction = 0.2,
): { topShare: number; fractionForEighty: number } {
  const sorted = [...values].filter((v) => v > 0).sort((a, b) => b - a);
  const n = sorted.length;
  const total = sorted.reduce((sum, v) => sum + v, 0);

  if (n === 0 || total === 0) {
    return { topShare: Number.NaN, fractionForEighty: Number.NaN };
  }

  const topCount = Math.max(1, Math.ceil(n * fraction));
  const topSum = sorted.slice(0, topCount).reduce((sum, v) => sum + v, 0);

  let cumulative = 0;
  let needed = n;
  for (let i = 0; i < n; i++) {
    cumulative += sorted[i];
    if (cumulative / total >= 0.8) {
      needed = i + 1;
      break;
    }
  }

  return { topShare: topSum / total, fractionForEighty: needed / n };
}

/**
 * A plain-English reading of a Gini value.
 *
 * Bands are conventional rather than derived, and labelled as such. A number
 * with no interpretation gets ignored; a number with a fake-precise
 * interpretation gets over-trusted.
 */
export function concentrationLabel(giniValue: number): string {
  if (!Number.isFinite(giniValue)) return "Not enough data";
  if (giniValue < 0.3) return "Evenly spread";
  if (giniValue < 0.45) return "Moderately concentrated";
  if (giniValue < 0.6) return "Concentrated";
  return "Highly concentrated";
}
