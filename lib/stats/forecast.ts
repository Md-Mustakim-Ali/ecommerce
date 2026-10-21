import { standardDeviation } from "./descriptive";
import { normalQuantile } from "./distributions";

/**
 * Forecasting by exponential smoothing.
 *
 * Holt-Winters (additive) rather than a straight line, because commerce data
 * has all three components this model has terms for: a level, a trend, and a
 * weekly cycle. Fitting a trend without the cycle produces a forecast that is
 * confidently wrong every Saturday.
 *
 * Every forecast comes with a prediction interval. A point forecast on its own
 * invites someone to plan against a single number that the model itself does
 * not believe, and the interval widens with horizon exactly as the uncertainty
 * does.
 */

export type ForecastPoint = {
  /** Steps ahead of the last observation, starting at 1. */
  horizon: number;
  value: number;
  low: number;
  high: number;
};

export type ForecastResult = {
  points: ForecastPoint[];
  /** In-sample one-step residual standard deviation. */
  residualSd: number;
  /** Mean absolute percentage error over the fitted window. */
  mape: number;
  /** Fitted one-step-ahead values, aligned with the input. */
  fitted: number[];
  method: "holt-winters" | "holt" | "drift" | "mean";
  seasonLength: number;
};

/**
 * Holt-Winters additive smoothing.
 *
 * Additive rather than multiplicative: a store with a zero-revenue day breaks
 * the multiplicative form, and additive seasonality is the safer default when
 * the series is not guaranteed positive.
 *
 * Falls back through simpler models when there is not enough history. A
 * seasonal model fitted to one and a half cycles is fitting noise, and it is
 * better to return an honest flat forecast with wide intervals than a
 * confident wrong shape.
 */
export function forecast(
  series: readonly number[],
  options: {
    horizon?: number;
    seasonLength?: number;
    /** Level smoothing. */
    alpha?: number;
    /** Trend smoothing. */
    beta?: number;
    /** Seasonal smoothing. */
    gamma?: number;
    confidence?: number;
    /**
     * Damps the trend as the horizon grows. An undamped linear trend
     * extrapolated 90 days out is how forecasts end up predicting a store will
     * do more revenue than the entire market.
     */
    damping?: number;
  } = {},
): ForecastResult {
  const horizon = options.horizon ?? 14;
  const seasonLength = options.seasonLength ?? 7;
  const alpha = options.alpha ?? 0.3;
  const beta = options.beta ?? 0.08;
  const gamma = options.gamma ?? 0.25;
  const confidence = options.confidence ?? 0.9;
  const phi = options.damping ?? 0.92;

  const n = series.length;
  const z = normalQuantile(1 - (1 - confidence) / 2);

  // Not enough to fit anything: return the mean with an interval from its own
  // spread. Honest and useless, which is the correct combination here.
  if (n < 4) {
    const level = n === 0 ? 0 : series.reduce((s, v) => s + v, 0) / n;
    const sd = n > 1 ? standardDeviation(series) : 0;
    return {
      points: Array.from({ length: horizon }, (_, i) => ({
        horizon: i + 1,
        value: level,
        low: level - z * sd,
        high: level + z * sd,
      })),
      residualSd: sd,
      mape: Number.NaN,
      fitted: [...series],
      method: "mean",
      seasonLength: 0,
    };
  }

  const seasonal = n >= seasonLength * 2;
  const period = seasonal ? seasonLength : 0;

  // --- Initialisation -----------------------------------------------------
  let level: number;
  let trend: number;
  const indices: number[] = [];

  if (seasonal) {
    // Level and trend from the first two whole cycles; seasonal indices from
    // each period's deviation from its own cycle mean.
    const first = series.slice(0, period);
    const second = series.slice(period, period * 2);
    const firstMean = first.reduce((s, v) => s + v, 0) / period;
    const secondMean = second.reduce((s, v) => s + v, 0) / period;

    level = firstMean;
    trend = (secondMean - firstMean) / period;

    for (let i = 0; i < period; i++) {
      indices.push((first[i] - firstMean + (second[i] - secondMean)) / 2);
    }
  } else {
    level = series[0];
    trend = series[1] - series[0];
  }

  // --- Fitting ------------------------------------------------------------
  const fitted: number[] = [];
  const residuals: number[] = [];
  const percentErrors: number[] = [];

  for (let t = 0; t < n; t++) {
    const seasonalIndex = seasonal ? indices[t % period] : 0;
    const prediction = level + trend + seasonalIndex;
    fitted.push(prediction);

    // Residuals only from the point the model is actually initialised, so the
    // startup transient does not inflate the interval.
    if (t >= (seasonal ? period * 2 : 2)) {
      const error = series[t] - prediction;
      residuals.push(error);
      if (series[t] !== 0) {
        percentErrors.push(Math.abs(error / series[t]));
      }
    }

    const previousLevel = level;
    const deseasonalised = series[t] - seasonalIndex;

    level = alpha * deseasonalised + (1 - alpha) * (level + trend);
    trend = beta * (level - previousLevel) + (1 - beta) * trend;
    if (seasonal) {
      indices[t % period] =
        gamma * (series[t] - level) + (1 - gamma) * seasonalIndex;
    }
  }

  const residualSd =
    residuals.length > 1
      ? standardDeviation(residuals)
      : standardDeviation(series);
  const mape =
    percentErrors.length > 0
      ? percentErrors.reduce((s, v) => s + v, 0) / percentErrors.length
      : Number.NaN;

  // --- Projection ---------------------------------------------------------
  const points: ForecastPoint[] = [];
  let dampedTrendSum = 0;

  for (let h = 1; h <= horizon; h++) {
    // Damped trend: the sum phi + phi² + ... + phi^h converges, so the
    // forecast flattens instead of running away.
    dampedTrendSum += phi ** h;
    const seasonalIndex = seasonal ? indices[(n + h - 1) % period] : 0;
    const value = level + dampedTrendSum * trend + seasonalIndex;

    // Interval widens as sqrt(h) — the variance of a sum of h independent
    // one-step errors. This understates it slightly for a trending model,
    // which is why the trend is damped.
    const spread = z * residualSd * Math.sqrt(h);

    points.push({
      horizon: h,
      value,
      low: value - spread,
      high: value + spread,
    });
  }

  return {
    points,
    residualSd,
    mape,
    fitted,
    method: seasonal ? "holt-winters" : "holt",
    seasonLength: period,
  };
}

/**
 * Centred moving average.
 *
 * Centred, not trailing: a trailing average lags the series by half its window
 * and makes a turning point look like it happened later than it did. For a
 * chart overlay, alignment matters more than being computable in real time.
 */
export function movingAverage(
  series: readonly number[],
  window: number,
): (number | null)[] {
  if (window < 1) throw new RangeError(`window must be >= 1, got ${window}`);

  const half = Math.floor(window / 2);
  return series.map((_, index) => {
    const start = index - half;
    const end = start + window;
    if (start < 0 || end > series.length) return null;

    let sum = 0;
    for (let i = start; i < end; i++) sum += series[i];
    return sum / window;
  });
}

/**
 * Additive decomposition into trend, seasonal and remainder.
 *
 * Classical decomposition: a centred moving average for the trend, the mean
 * detrended value per position for the seasonal figure, and whatever is left
 * as the remainder. Enough to answer "is Friday genuinely better, or is that
 * just the trend passing through Friday".
 */
export function decompose(
  series: readonly number[],
  seasonLength = 7,
): {
  trend: (number | null)[];
  seasonal: number[];
  remainder: (number | null)[];
  /** One index per position in the cycle, summing to zero. */
  seasonalIndices: number[];
} {
  const trend = movingAverage(series, seasonLength);

  const detrended = series.map((value, index) => {
    const t = trend[index];
    return t === null ? null : value - t;
  });

  const sums = new Array<number>(seasonLength).fill(0);
  const counts = new Array<number>(seasonLength).fill(0);
  detrended.forEach((value, index) => {
    if (value === null) return;
    const slot = index % seasonLength;
    sums[slot] += value;
    counts[slot] += 1;
  });

  const raw = sums.map((sum, i) => (counts[i] === 0 ? 0 : sum / counts[i]));
  // Centred so the indices sum to zero, which is what makes them additive
  // adjustments rather than a second level term.
  const offset = raw.reduce((s, v) => s + v, 0) / seasonLength;
  const seasonalIndices = raw.map((v) => v - offset);

  const seasonal = series.map(
    (_, index) => seasonalIndices[index % seasonLength],
  );
  const remainder = series.map((value, index) => {
    const t = trend[index];
    return t === null ? null : value - t - seasonal[index];
  });

  return { trend, seasonal, remainder, seasonalIndices };
}

/**
 * Anomaly detection on the decomposition remainder.
 *
 * Scoring the raw series would flag every Saturday on a business with a weekly
 * cycle. Scoring what is left after trend and season are removed flags only
 * what the model genuinely did not expect.
 *
 * Uses the median and MAD rather than mean and standard deviation: outliers
 * inflate a standard deviation, so a run of anomalies raises the bar for
 * detecting the next one — the exact opposite of what is wanted.
 */
export function detectAnomalies(
  series: readonly number[],
  options: { seasonLength?: number; threshold?: number } = {},
): {
  index: number;
  value: number;
  score: number;
  direction: "high" | "low";
}[] {
  const seasonLength = options.seasonLength ?? 7;
  const threshold = options.threshold ?? 3;

  if (series.length < seasonLength * 2) return [];

  const { remainder } = decompose(series, seasonLength);
  const present = remainder.filter((v): v is number => v !== null);
  if (present.length < 4) return [];

  const sorted = [...present].sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)];
  const deviations = present
    .map((v) => Math.abs(v - mid))
    .sort((a, b) => a - b);
  const mad = deviations[Math.floor(deviations.length / 2)];

  // 1.4826 makes the MAD a consistent estimator of sigma for normal data, so
  // the threshold keeps its usual "number of sigmas" meaning.
  //
  // Floored rather than bailed out on. MAD is robust to outliers, which is the
  // reason for choosing it — but on a near-perfectly regular series the
  // non-outlier remainder is floating-point dust, the MAD is dust, and scoring
  // against it reports every ordinary day as a 300-sigma event. Flooring the
  // scale at something negligible relative to the series keeps dust
  // unremarkable while leaving a genuine spike enormous.
  const level = Math.max(...series.map(Math.abs), 1);
  const scale = Math.max(mad * 1.4826, level * 1e-9);

  const found: {
    index: number;
    value: number;
    score: number;
    direction: "high" | "low";
  }[] = [];

  remainder.forEach((value, index) => {
    if (value === null) return;
    const score = (value - mid) / scale;
    if (Math.abs(score) >= threshold) {
      found.push({
        index,
        value: series[index],
        score,
        direction: score > 0 ? "high" : "low",
      });
    }
  });

  return found;
}
