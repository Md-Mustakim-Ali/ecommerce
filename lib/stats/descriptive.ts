/**
 * Descriptive statistics.
 *
 * All of these take a plain number array and return plain numbers. Nothing
 * here knows about orders or money — that mapping happens in lib/analytics,
 * which keeps this layer testable against textbook values.
 */

export function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Sample variance, Welford's online algorithm.
 *
 * Not `E[x²] - E[x]²`. That form loses catastrophic precision when the mean is
 * large relative to the spread, which is exactly the case for daily revenue in
 * minor units: values around 5,000,000 with a spread of 50,000.
 */
export function variance(
  values: readonly number[],
  population = false,
): number {
  const n = values.length;
  if (n === 0) return Number.NaN;
  if (n === 1) return population ? 0 : Number.NaN;

  let runningMean = 0;
  let m2 = 0;
  let count = 0;

  for (const value of values) {
    count += 1;
    const delta = value - runningMean;
    runningMean += delta / count;
    m2 += delta * (value - runningMean);
  }

  return m2 / (population ? n : n - 1);
}

export function standardDeviation(
  values: readonly number[],
  population = false,
): number {
  return Math.sqrt(variance(values, population));
}

/** Standard error of the mean. */
export function standardError(values: readonly number[]): number {
  if (values.length < 2) return Number.NaN;
  return standardDeviation(values) / Math.sqrt(values.length);
}

/**
 * Quantile by linear interpolation between order statistics.
 *
 * This is R's type 7 and NumPy's default. Stating which definition is in use
 * matters: the nine standard definitions disagree, and a median that moves
 * when you change library is a bug report waiting to happen.
 */
export function quantile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  if (p < 0 || p > 1)
    throw new RangeError(`quantile needs 0 <= p <= 1, got ${p}`);

  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];

  const index = p * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];

  return sorted[lower] + (index - lower) * (sorted[upper] - sorted[lower]);
}

export function median(values: readonly number[]): number {
  return quantile(values, 0.5);
}

/** Interquartile range, and the Tukey fences built on it. */
export function iqr(values: readonly number[]) {
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  const spread = q3 - q1;
  return {
    q1,
    q3,
    iqr: spread,
    // 1.5x is the conventional fence; 3x marks a far outlier.
    lowerFence: q1 - 1.5 * spread,
    upperFence: q3 + 1.5 * spread,
    farLowerFence: q1 - 3 * spread,
    farUpperFence: q3 + 3 * spread,
  };
}

/** Fisher-Pearson standardised moment coefficient (sample skewness, g1). */
export function skewness(values: readonly number[]): number {
  const n = values.length;
  if (n < 3) return Number.NaN;
  const m = mean(values);
  const s = standardDeviation(values);
  if (s === 0) return 0;

  const sum = values.reduce((acc, v) => acc + ((v - m) / s) ** 3, 0);
  // The n/((n-1)(n-2)) factor is the bias correction; without it small samples
  // read as far more symmetric than they are.
  return (n / ((n - 1) * (n - 2))) * sum;
}

/** Excess kurtosis (g2): 0 for a normal distribution, positive for heavy tails. */
export function kurtosis(values: readonly number[]): number {
  const n = values.length;
  if (n < 4) return Number.NaN;
  const m = mean(values);
  const s = standardDeviation(values);
  if (s === 0) return 0;

  const sum = values.reduce((acc, v) => acc + ((v - m) / s) ** 4, 0);
  const g2 =
    ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * sum -
    (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
  return g2;
}

/** Coefficient of variation: spread relative to level, so it is unitless. */
export function coefficientOfVariation(values: readonly number[]): number {
  const m = mean(values);
  if (m === 0) return Number.NaN;
  return standardDeviation(values) / Math.abs(m);
}

/** Pearson correlation between two equal-length series. */
export function correlation(
  xs: readonly number[],
  ys: readonly number[],
): number {
  if (xs.length !== ys.length) {
    throw new Error(
      `correlation needs equal lengths, got ${xs.length}/${ys.length}`,
    );
  }
  if (xs.length < 2) return Number.NaN;

  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;

  for (let i = 0; i < xs.length; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }

  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? Number.NaN : num / denom;
}

export function summarise(values: readonly number[]) {
  return {
    n: values.length,
    mean: mean(values),
    median: median(values),
    sd: standardDeviation(values),
    min: values.length === 0 ? Number.NaN : Math.min(...values),
    max: values.length === 0 ? Number.NaN : Math.max(...values),
    ...iqr(values),
    skewness: skewness(values),
    kurtosis: kurtosis(values),
    cv: coefficientOfVariation(values),
  };
}
