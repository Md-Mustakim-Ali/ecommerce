import { mean } from "./descriptive";
import { studentTCdf, studentTQuantile } from "./distributions";

/**
 * Ordinary least squares, one predictor.
 *
 * Reported with R², the standard error of the slope, and a p-value on it —
 * because a trend line drawn without them is an assertion, and on 30 noisy
 * days of revenue an eye-catching slope is very often not distinguishable
 * from zero.
 */

export type LinearFit = {
  slope: number;
  intercept: number;
  /** Proportion of variance explained. */
  r2: number;
  /** Standard error of the slope estimate. */
  slopeStdError: number;
  /** Residual standard error, in the units of y. */
  residualStdError: number;
  df: number;
  /** Two-sided p-value for H0: slope = 0. */
  pValue: number;
  predict: (x: number) => number;
  /** Confidence interval on the slope. */
  slopeInterval: (confidence?: number) => { low: number; high: number };
};

export function linearRegression(
  xs: readonly number[],
  ys: readonly number[],
): LinearFit {
  if (xs.length !== ys.length) {
    throw new Error(
      `linearRegression needs equal lengths, got ${xs.length}/${ys.length}`,
    );
  }

  const n = xs.length;
  const mx = mean(xs);
  const my = mean(ys);

  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }

  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const predict = (x: number) => intercept + slope * x;

  // Residual sum of squares, and the two standard errors built on it.
  let rss = 0;
  for (let i = 0; i < n; i++) rss += (ys[i] - predict(xs[i])) ** 2;

  const df = n - 2;
  const residualStdError = df > 0 ? Math.sqrt(rss / df) : Number.NaN;
  const slopeStdError =
    df > 0 && sxx > 0 ? residualStdError / Math.sqrt(sxx) : Number.NaN;

  const r2 = syy === 0 ? Number.NaN : 1 - rss / syy;

  const t = slopeStdError > 0 ? slope / slopeStdError : Number.NaN;
  const pValue =
    df > 0 && Number.isFinite(t)
      ? 2 * (1 - studentTCdf(Math.abs(t), df))
      : Number.NaN;

  return {
    slope,
    intercept,
    r2,
    slopeStdError,
    residualStdError,
    df,
    pValue,
    predict,
    slopeInterval: (confidence = 0.95) => {
      if (!(df > 0) || !Number.isFinite(slopeStdError)) {
        return { low: Number.NaN, high: Number.NaN };
      }
      const critical = studentTQuantile(1 - (1 - confidence) / 2, df);
      return {
        low: slope - critical * slopeStdError,
        high: slope + critical * slopeStdError,
      };
    },
  };
}

/**
 * Compound growth rate implied by a series, fitted in log space.
 *
 * Revenue compounds, so a straight line through the levels understates growth
 * when it is real and overstates it when it is flattening. Regressing log(y)
 * on t and exponentiating the slope gives the per-period multiplier.
 *
 * Non-positive values are dropped rather than clamped: log(0) is not a number
 * this can pretend to know, and a zero-revenue day carries no growth
 * information.
 */
export function growthRate(values: readonly number[]): {
  perPeriod: number;
  r2: number;
  usable: number;
} {
  const xs: number[] = [];
  const ys: number[] = [];

  values.forEach((value, index) => {
    if (value > 0) {
      xs.push(index);
      ys.push(Math.log(value));
    }
  });

  if (xs.length < 3)
    return { perPeriod: Number.NaN, r2: Number.NaN, usable: xs.length };

  const fit = linearRegression(xs, ys);
  return {
    // exp(slope) - 1 is the fractional change per period.
    perPeriod: Math.exp(fit.slope) - 1,
    r2: fit.r2,
    usable: xs.length,
  };
}
