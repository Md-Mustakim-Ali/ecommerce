/**
 * Distribution functions.
 *
 * Everything else in lib/stats is built on these, so they are written as
 * numerical approximations with stated error bounds rather than lookup tables.
 * A table would be fine for the handful of confidence levels a dashboard
 * offers today and wrong the moment somebody wants a different one.
 */

/**
 * Regularised lower incomplete gamma P(a, x), by series below the transition
 * point and continued fraction above it.
 *
 * Both expansions converge quickly on their own side and badly on the other,
 * which is why the split at x < a+1 is the standard formulation rather than a
 * micro-optimisation.
 */
function lowerGammaP(a: number, x: number): number {
  if (x < 0 || a <= 0) return Number.NaN;
  if (x === 0) return 0;

  if (x < a + 1) {
    // Series expansion.
    let term = 1 / a;
    let sum = term;
    for (let n = 1; n < 300; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-17) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }

  // Continued fraction for the upper tail Q(a,x), then complement it.
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;

  for (let i = 1; i < 300; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const step = d * c;
    h *= step;
    if (Math.abs(step - 1) < 1e-17) break;
  }

  const q = Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
  return 1 - q;
}

/**
 * Error function.
 *
 * Built on the incomplete gamma identity erf(x) = P(1/2, x²) rather than a
 * rational fit. Accurate to roughly machine epsilon, which matters more than
 * it first appears: `normalQuantile` refines itself against `normalCdf`, so
 * every digit lost here is a digit lost in every confidence interval and every
 * service level on the platform.
 */
export function erf(x: number): number {
  if (x === 0) return 0;
  const sign = x < 0 ? -1 : 1;
  return sign * lowerGammaP(0.5, x * x);
}

/** Standard normal CDF: P(Z <= z). */
export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Standard normal PDF. */
export function normalPdf(z: number): number {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

/**
 * Inverse standard normal CDF (the probit), Acklam's rational approximation
 * refined by one Halley step against `normalCdf`.
 *
 * Relative error below 1e-9 after refinement. This is the function behind every
 * "95% confidence" and every service level, so it is worth the extra step.
 */
export function normalQuantile(p: number): number {
  if (p <= 0 || p >= 1) {
    if (p === 0) return Number.NEGATIVE_INFINITY;
    if (p === 1) return Number.POSITIVE_INFINITY;
    throw new RangeError(`normalQuantile needs 0 < p < 1, got ${p}`);
  }

  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];

  const plow = 0.02425;
  const phigh = 1 - plow;
  let x: number;

  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    x =
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= phigh) {
    const q = p - 0.5;
    const r = q * q;
    x =
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
        q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x =
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  // One Halley refinement against the CDF. Cheap, and it takes the initial
  // ~1e-9 relative error down to machine precision.
  const e = normalCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

/**
 * Log-gamma, Lanczos approximation (g=7, n=9).
 *
 * Needed by the t and chi-squared distributions below. Computed in log space
 * because gamma overflows a double at around n=171 and order counts get there.
 */
export function logGamma(x: number): number {
  const g = 7;
  const coefficients = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];

  if (x < 0.5) {
    // Reflection formula, for the left half plane.
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }

  const z = x - 1;
  let a = coefficients[0];
  const t = z + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += coefficients[i] / (z + i);

  return (
    0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a)
  );
}

/**
 * Regularised incomplete beta function I_x(a, b), by continued fraction
 * (Lentz's algorithm).
 *
 * This is the CDF machinery for the t-distribution.
 */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const front =
    Math.exp(
      logGamma(a + b) -
        logGamma(a) -
        logGamma(b) +
        a * Math.log(x) +
        b * Math.log(1 - x),
    ) / a;

  // The continued fraction converges quickly for x < (a+1)/(a+b+2); outside
  // that, evaluate the complement instead.
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - incompleteBeta(1 - x, b, a);
  }

  const tiny = 1e-30;
  let f = 1;
  let c = 1;
  let d = 0;

  for (let i = 0; i <= 300; i++) {
    const m = Math.floor(i / 2);
    let numerator: number;

    if (i === 0) {
      numerator = 1;
    } else if (i % 2 === 0) {
      numerator = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    } else {
      numerator =
        -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    }

    d = 1 + numerator * d;
    if (Math.abs(d) < tiny) d = tiny;
    d = 1 / d;

    c = 1 + numerator / c;
    if (Math.abs(c) < tiny) c = tiny;

    const step = c * d;
    f *= step;

    if (Math.abs(1 - step) < 1e-12) break;
  }

  return front * (f - 1);
}

/** Student's t CDF with `df` degrees of freedom. */
export function studentTCdf(t: number, df: number): number {
  if (df <= 0) throw new RangeError(`df must be positive, got ${df}`);
  const x = df / (df + t * t);
  const tail = 0.5 * incompleteBeta(x, df / 2, 0.5);
  return t > 0 ? 1 - tail : tail;
}

/**
 * Student's t quantile, by bisection on the CDF.
 *
 * Bisection rather than a closed form: it is a handful of iterations on a
 * monotone function, it cannot diverge, and this is not a hot path.
 */
export function studentTQuantile(p: number, df: number): number {
  if (p <= 0 || p >= 1) {
    throw new RangeError(`studentTQuantile needs 0 < p < 1, got ${p}`);
  }
  // For large df the t converges to the normal; skip the search.
  if (df > 2000) return normalQuantile(p);

  let low = -1000;
  let high = 1000;
  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    if (studentTCdf(mid, df) < p) low = mid;
    else high = mid;
    if (high - low < 1e-12) break;
  }
  return (low + high) / 2;
}

/**
 * Poisson PMF: P(X = k) for rate lambda.
 *
 * Computed through log-gamma rather than a factorial, because a factorial
 * overflows well before the counts a busy store produces.
 */
export function poissonPmf(k: number, lambda: number): number {
  if (k < 0 || !Number.isInteger(k)) return 0;
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return Math.exp(k * Math.log(lambda) - lambda - logGamma(k + 1));
}

/** Poisson CDF: P(X <= k). */
export function poissonCdf(k: number, lambda: number): number {
  if (k < 0) return 0;
  let sum = 0;
  for (let i = 0; i <= Math.floor(k); i++) sum += poissonPmf(i, lambda);
  return Math.min(1, sum);
}
