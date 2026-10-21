import { describe, expect, it } from "vitest";
import {
  concentrationLabel,
  effectiveCount,
  gini,
  herfindahl,
  lorenzCurve,
  paretoShare,
} from "./concentration";
import {
  coefficientOfVariation,
  correlation,
  iqr,
  kurtosis,
  mean,
  median,
  quantile,
  skewness,
  standardDeviation,
  variance,
} from "./descriptive";
import {
  erf,
  incompleteBeta,
  logGamma,
  normalCdf,
  normalQuantile,
  poissonCdf,
  poissonPmf,
  studentTCdf,
  studentTQuantile,
} from "./distributions";
import {
  decompose,
  detectAnomalies,
  forecast,
  movingAverage,
} from "./forecast";
import {
  bayesianRating,
  meanInterval,
  proportionInterval,
  twoProportionTest,
  welchTTest,
  wilsonLowerBound,
} from "./inference";
import {
  daysOfCover,
  economicOrderQuantity,
  reorderPoint,
  riskBand,
  stockoutRisk,
} from "./inventory";
import { growthRate, linearRegression } from "./regression";

/**
 * These are checked against published values, not against the implementation.
 * A statistics library that only agrees with itself is worthless — the whole
 * point is that the numbers on the dashboard are the numbers a statistician
 * would compute by hand.
 */

describe("distributions", () => {
  it("erf matches known values", () => {
    expect(erf(0)).toBeCloseTo(0, 10);
    expect(erf(1)).toBeCloseTo(0.8427007929, 6);
    expect(erf(2)).toBeCloseTo(0.995322265, 6);
    expect(erf(-1)).toBeCloseTo(-0.8427007929, 6);
  });

  it("normalCdf matches the standard normal table", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 8);
    expect(normalCdf(1)).toBeCloseTo(0.8413447461, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.9750021049, 6);
    expect(normalCdf(-2.576)).toBeCloseTo(0.0049942, 5);
  });

  it("normalQuantile inverts normalCdf", () => {
    // The critical values everybody knows.
    expect(normalQuantile(0.975)).toBeCloseTo(1.959963985, 7);
    expect(normalQuantile(0.995)).toBeCloseTo(2.575829304, 7);
    expect(normalQuantile(0.5)).toBeCloseTo(0, 9);
    expect(normalQuantile(0.9)).toBeCloseTo(1.281551566, 7);

    for (const p of [0.001, 0.05, 0.25, 0.5, 0.75, 0.95, 0.999]) {
      expect(normalCdf(normalQuantile(p))).toBeCloseTo(p, 8);
    }
  });

  it("logGamma matches factorials", () => {
    // gamma(n) = (n-1)!
    expect(Math.exp(logGamma(5))).toBeCloseTo(24, 6);
    expect(Math.exp(logGamma(6))).toBeCloseTo(120, 5);
    // gamma(1/2) = sqrt(pi)
    expect(Math.exp(logGamma(0.5))).toBeCloseTo(Math.sqrt(Math.PI), 8);
  });

  it("incompleteBeta is bounded and monotone", () => {
    expect(incompleteBeta(0, 2, 3)).toBe(0);
    expect(incompleteBeta(1, 2, 3)).toBe(1);
    // I_0.5(1,1) is just x for a=b=1.
    expect(incompleteBeta(0.5, 1, 1)).toBeCloseTo(0.5, 8);

    let previous = 0;
    for (let x = 0.05; x < 1; x += 0.05) {
      const value = incompleteBeta(x, 2, 5);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it("studentT quantiles match the t table", () => {
    // Two-sided 95% critical values, the ones printed in every textbook.
    expect(studentTQuantile(0.975, 1)).toBeCloseTo(12.706, 2);
    expect(studentTQuantile(0.975, 10)).toBeCloseTo(2.228, 2);
    expect(studentTQuantile(0.975, 30)).toBeCloseTo(2.042, 2);
    expect(studentTQuantile(0.995, 20)).toBeCloseTo(2.845, 2);
  });

  it("studentT converges to the normal as df grows", () => {
    expect(studentTQuantile(0.975, 100000)).toBeCloseTo(1.96, 2);
    expect(studentTCdf(0, 5)).toBeCloseTo(0.5, 8);
  });

  it("poisson pmf sums to one and matches known values", () => {
    // P(X=0 | lambda=2) = e^-2
    expect(poissonPmf(0, 2)).toBeCloseTo(Math.exp(-2), 9);
    expect(poissonPmf(2, 2)).toBeCloseTo(0.2706705665, 8);

    let total = 0;
    for (let k = 0; k <= 60; k++) total += poissonPmf(k, 6);
    expect(total).toBeCloseTo(1, 8);

    expect(poissonCdf(3, 3)).toBeCloseTo(0.6472318774, 7);
  });
});

describe("descriptive", () => {
  const sample = [2, 4, 4, 4, 5, 5, 7, 9];

  it("computes the textbook mean and variance", () => {
    expect(mean(sample)).toBe(5);
    // Population variance of this classic sample is 4; sample variance 32/7.
    expect(variance(sample, true)).toBeCloseTo(4, 10);
    expect(variance(sample)).toBeCloseTo(32 / 7, 10);
    expect(standardDeviation(sample, true)).toBeCloseTo(2, 10);
  });

  it("Welford survives a large offset that would break the naive formula", () => {
    const offset = 1e9;
    const shifted = sample.map((v) => v + offset);
    // The E[x²]-E[x]² form loses every significant digit here.
    expect(variance(shifted, true)).toBeCloseTo(4, 6);
  });

  it("quantile uses the type-7 definition", () => {
    const values = [1, 2, 3, 4];
    expect(quantile(values, 0)).toBe(1);
    expect(quantile(values, 1)).toBe(4);
    expect(median(values)).toBeCloseTo(2.5, 10);
    // Type 7: index = p(n-1) = 0.25*3 = 0.75, so 1 + 0.75*(2-1).
    expect(quantile(values, 0.25)).toBeCloseTo(1.75, 10);
  });

  it("derives Tukey fences from the IQR", () => {
    const result = iqr([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(result.q1).toBeCloseTo(3, 10);
    expect(result.q3).toBeCloseTo(7, 10);
    expect(result.iqr).toBeCloseTo(4, 10);
    expect(result.upperFence).toBeCloseTo(13, 10);
    expect(result.farUpperFence).toBeCloseTo(19, 10);
  });

  it("reports shape", () => {
    // A symmetric sample has near-zero skew.
    expect(skewness([1, 2, 3, 4, 5])).toBeCloseTo(0, 10);
    // A right tail is positive skew.
    expect(skewness([1, 1, 1, 1, 10])).toBeGreaterThan(1);
    // Excess kurtosis of a heavy-tailed sample is positive.
    expect(kurtosis([1, 1, 1, 1, 1, 1, 1, 20])).toBeGreaterThan(1);
    expect(coefficientOfVariation([10, 10, 10])).toBeCloseTo(0, 10);
  });

  it("computes Pearson correlation", () => {
    expect(correlation([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10);
    expect(correlation([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 10);
    expect(Math.abs(correlation([1, 2, 3, 4], [1, 3, 2, 4]))).toBeLessThan(1);
  });

  it("refuses to invent a variance from one point", () => {
    expect(Number.isNaN(variance([5]))).toBe(true);
    expect(variance([5], true)).toBe(0);
  });
});

describe("inference", () => {
  it("builds a t confidence interval", () => {
    // Ten values, mean 10, sd 2 => se 0.6325, t(0.975, 9) = 2.262.
    const values = [8, 9, 9, 10, 10, 10, 11, 11, 12, 10];
    const ci = meanInterval(values);
    expect(ci.estimate).toBeCloseTo(10, 10);
    expect(ci.low).toBeLessThan(10);
    expect(ci.high).toBeGreaterThan(10);
    // Symmetric about the estimate.
    expect(ci.high - ci.estimate).toBeCloseTo(ci.estimate - ci.low, 10);
  });

  it("Wilson stays inside [0,1] where the normal approximation does not", () => {
    // 0 successes: the normal interval collapses to [0,0] and claims certainty.
    const none = proportionInterval(0, 20);
    expect(none.low).toBeCloseTo(0, 12);
    expect(none.high).toBeGreaterThan(0);
    expect(none.high).toBeLessThan(1);

    const all = proportionInterval(20, 20);
    expect(all.high).toBe(1);
    expect(all.low).toBeLessThan(1);
    expect(all.low).toBeGreaterThan(0);

    // Published example: 5/10 at 95% is roughly (0.237, 0.763).
    const half = proportionInterval(5, 10);
    expect(half.low).toBeCloseTo(0.2366, 3);
    expect(half.high).toBeCloseTo(0.7634, 3);
  });

  it("a larger sample gives a narrower interval", () => {
    const small = proportionInterval(5, 10);
    const large = proportionInterval(500, 1000);
    expect(large.high - large.low).toBeLessThan(small.high - small.low);
  });

  it("Welch's t-test separates genuinely different groups", () => {
    const a = [20, 21, 19, 20, 22, 21, 20, 19];
    const b = [30, 31, 29, 30, 32, 31, 30, 29];
    const result = welchTTest(a, b);
    expect(result.meanDifference).toBeCloseTo(-10, 5);
    expect(result.pValue).toBeLessThan(0.001);
    expect(result.significant()).toBe(true);
  });

  it("and does not separate identical ones", () => {
    const a = [10, 11, 9, 10, 11, 9];
    const result = welchTTest(a, [...a]);
    expect(result.t).toBeCloseTo(0, 10);
    expect(result.pValue).toBeCloseTo(1, 6);
    expect(result.significant()).toBe(false);
  });

  it("compares two proportions", () => {
    const result = twoProportionTest(
      { successes: 100, trials: 1000 },
      { successes: 150, trials: 1000 },
    );
    expect(result.difference).toBeCloseTo(-0.05, 10);
    expect(result.pValue).toBeLessThan(0.01);
  });

  it("shrinks a thin rating toward the prior", () => {
    // One 5-star review should not beat 900 reviews averaging 4.7.
    const thin = bayesianRating({ sum: 5, count: 1, priorMean: 4.2 });
    const thick = bayesianRating({
      sum: 4.7 * 900,
      count: 900,
      priorMean: 4.2,
    });
    expect(thin).toBeLessThan(thick);
    // With no reviews it is exactly the prior.
    expect(bayesianRating({ sum: 0, count: 0, priorMean: 4.2 })).toBe(4.2);
    // With overwhelming evidence it converges on the observed mean.
    const huge = bayesianRating({
      sum: 5 * 100000,
      count: 100000,
      priorMean: 1,
    });
    expect(huge).toBeCloseTo(5, 3);
  });

  it("ranks by Wilson lower bound rather than raw proportion", () => {
    // Both are 100% positive; the one with more evidence must rank higher.
    expect(wilsonLowerBound(1, 1)).toBeLessThan(wilsonLowerBound(100, 100));
  });
});

describe("regression", () => {
  it("recovers a known line exactly", () => {
    const xs = [0, 1, 2, 3, 4];
    const ys = xs.map((x) => 3 * x + 7);
    const fit = linearRegression(xs, ys);

    expect(fit.slope).toBeCloseTo(3, 10);
    expect(fit.intercept).toBeCloseTo(7, 10);
    expect(fit.r2).toBeCloseTo(1, 10);
    expect(fit.predict(10)).toBeCloseTo(37, 10);
  });

  it("reports a weak fit as weak", () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8];
    const ys = [5, 2, 8, 1, 9, 3, 7, 4];
    const fit = linearRegression(xs, ys);
    expect(fit.r2).toBeLessThan(0.2);
    // A slope this noisy must not read as significant.
    expect(fit.pValue).toBeGreaterThan(0.05);
  });

  it("puts a confidence interval on the slope", () => {
    const xs = Array.from({ length: 30 }, (_, i) => i);
    const ys = xs.map((x) => 2 * x + (x % 3) - 1);
    const fit = linearRegression(xs, ys);
    const interval = fit.slopeInterval(0.95);

    expect(interval.low).toBeLessThan(fit.slope);
    expect(interval.high).toBeGreaterThan(fit.slope);
    // The true slope is inside the interval.
    expect(interval.low).toBeLessThan(2);
    expect(interval.high).toBeGreaterThan(2);
  });

  it("finds a compound growth rate", () => {
    // Exactly 10% per period.
    const values = Array.from({ length: 20 }, (_, i) => 100 * 1.1 ** i);
    const growth = growthRate(values);
    expect(growth.perPeriod).toBeCloseTo(0.1, 8);
    expect(growth.r2).toBeCloseTo(1, 8);
  });

  it("ignores non-positive values rather than taking log of zero", () => {
    const growth = growthRate([0, 100, 110, 121, 0, 133.1]);
    expect(Number.isFinite(growth.perPeriod)).toBe(true);
    expect(growth.usable).toBe(4);
  });
});

describe("forecast", () => {
  /** A weekly cycle on a rising trend — the shape real commerce data has. */
  function seasonalSeries(weeks: number): number[] {
    const pattern = [80, 100, 105, 103, 112, 124, 94];
    const out: number[] = [];
    for (let i = 0; i < weeks * 7; i++) {
      out.push(pattern[i % 7] + i * 0.5);
    }
    return out;
  }

  it("recovers the weekly shape", () => {
    const series = seasonalSeries(10);
    const result = forecast(series, { horizon: 7 });

    expect(result.method).toBe("holt-winters");
    expect(result.seasonLength).toBe(7);
    // The forecast peak must land on the same weekday as the data's peak.
    const values = result.points.map((p) => p.value);
    const peak = values.indexOf(Math.max(...values));
    expect((series.length + peak) % 7).toBe(5);
  });

  it("keeps the point forecast inside its own interval", () => {
    const result = forecast(seasonalSeries(8), { horizon: 14 });
    for (const point of result.points) {
      expect(point.low).toBeLessThanOrEqual(point.value);
      expect(point.high).toBeGreaterThanOrEqual(point.value);
    }
  });

  it("widens the interval with the horizon", () => {
    const result = forecast(seasonalSeries(8), { horizon: 20 });
    const first = result.points[0];
    const last = result.points[result.points.length - 1];
    expect(last.high - last.low).toBeGreaterThan(first.high - first.low);
  });

  it("damps the trend instead of extrapolating forever", () => {
    const rising = Array.from({ length: 60 }, (_, i) => 100 + i * 10);
    const result = forecast(rising, { horizon: 100, seasonLength: 7 });
    const undampedAt100 = 100 + 159 * 10;
    // A damped forecast must fall well short of the naive line.
    expect(result.points[99].value).toBeLessThan(undampedAt100);
  });

  it("falls back honestly when there is almost no history", () => {
    const result = forecast([5, 7], { horizon: 3 });
    expect(result.method).toBe("mean");
    expect(result.points).toHaveLength(3);
    expect(result.points.every((p) => Number.isFinite(p.value))).toBe(true);
  });

  it("forecasts a flat series as flat", () => {
    const flat = new Array(60).fill(50);
    const result = forecast(flat, { horizon: 7 });
    for (const point of result.points) {
      expect(point.value).toBeCloseTo(50, 4);
    }
  });

  it("centres the moving average", () => {
    const smoothed = movingAverage([1, 2, 3, 4, 5], 3);
    expect(smoothed[0]).toBeNull();
    expect(smoothed[1]).toBeCloseTo(2, 10);
    expect(smoothed[2]).toBeCloseTo(3, 10);
    expect(smoothed[4]).toBeNull();
  });

  it("decomposes into components that add back up", () => {
    const series = seasonalSeries(6);
    const { trend, seasonal, remainder } = decompose(series, 7);

    for (let i = 0; i < series.length; i++) {
      if (trend[i] === null || remainder[i] === null) continue;
      expect(
        (trend[i] as number) + seasonal[i] + (remainder[i] as number),
      ).toBeCloseTo(series[i], 8);
    }
  });

  it("centres the seasonal indices on zero", () => {
    const { seasonalIndices } = decompose(seasonalSeries(8), 7);
    const total = seasonalIndices.reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(0, 8);
  });

  it("flags a spike but not the weekly peak", () => {
    const series = seasonalSeries(10);
    // The regular Saturday peak must not be flagged.
    expect(detectAnomalies(series, { seasonLength: 7 })).toHaveLength(0);

    // A genuine outlier on an ordinary weekday must be.
    const withSpike = [...series];
    withSpike[35] = 900;
    const found = detectAnomalies(withSpike, { seasonLength: 7 });
    expect(found.some((a) => a.index === 35 && a.direction === "high")).toBe(
      true,
    );
  });
});

describe("concentration", () => {
  it("gives Gini 0 for a flat distribution", () => {
    expect(gini([10, 10, 10, 10])).toBeCloseTo(0, 10);
  });

  it("approaches 1 as one item takes everything", () => {
    const skewed = gini([1, 1, 1, 1, 10000]);
    expect(skewed).toBeGreaterThan(0.75);
    expect(skewed).toBeLessThan(1);
  });

  it("matches a hand-computed value", () => {
    // For [1,2,3,4] the Gini is 0.25 exactly.
    expect(gini([1, 2, 3, 4])).toBeCloseTo(0.25, 10);
  });

  it("draws a Lorenz curve that ends at (1,1)", () => {
    const curve = lorenzCurve([1, 2, 3, 4]);
    expect(curve[0]).toEqual({ population: 0, value: 0 });
    const last = curve[curve.length - 1];
    expect(last.population).toBeCloseTo(1, 10);
    expect(last.value).toBeCloseTo(1, 10);

    // Always at or below the equality diagonal.
    for (const point of curve) {
      expect(point.value).toBeLessThanOrEqual(point.population + 1e-12);
    }
  });

  it("computes HHI and its effective count", () => {
    // Four equal shares: HHI = 4 * 0.25² = 0.25, effective count 4.
    expect(herfindahl([1, 1, 1, 1])).toBeCloseTo(0.25, 10);
    expect(effectiveCount([1, 1, 1, 1])).toBeCloseTo(4, 10);
    // A monopoly.
    expect(herfindahl([100])).toBeCloseTo(1, 10);
  });

  it("measures the real Pareto split rather than assuming 80/20", () => {
    const even = paretoShare(new Array(100).fill(1));
    // Perfectly even: the top 20% hold 20%, and 80% of items make 80%.
    expect(even.topShare).toBeCloseTo(0.2, 6);
    expect(even.fractionForEighty).toBeCloseTo(0.8, 2);

    const skewed = paretoShare([100, 50, 20, 5, 1, 1, 1, 1, 1, 1]);
    expect(skewed.topShare).toBeGreaterThan(0.5);
    expect(skewed.fractionForEighty).toBeLessThan(0.5);
  });

  it("labels the bands", () => {
    expect(concentrationLabel(0.1)).toBe("Evenly spread");
    expect(concentrationLabel(0.7)).toBe("Highly concentrated");
    expect(concentrationLabel(Number.NaN)).toBe("Not enough data");
  });
});

describe("inventory", () => {
  it("adds safety stock above average demand", () => {
    const result = reorderPoint({
      demandHistory: [10, 12, 8, 11, 9, 13, 10],
      leadTimeDays: 5,
      serviceLevel: 0.95,
    });

    expect(result.averageDemand).toBeCloseTo(10.4286, 3);
    expect(result.z).toBeCloseTo(1.6449, 3);
    expect(result.safetyStock).toBeGreaterThan(0);
    // Reordering at the average alone would stock out about half the time.
    expect(result.reorderPoint).toBeGreaterThan(result.averageDemand * 5);
  });

  it("requires more safety stock at a higher service level", () => {
    const history = [10, 12, 8, 11, 9, 13, 10];
    const at90 = reorderPoint({
      demandHistory: history,
      leadTimeDays: 5,
      serviceLevel: 0.9,
    });
    const at99 = reorderPoint({
      demandHistory: history,
      leadTimeDays: 5,
      serviceLevel: 0.99,
    });
    expect(at99.safetyStock).toBeGreaterThan(at90.safetyStock);
  });

  it("accounts for lead-time variability too", () => {
    const history = [10, 10, 10, 10, 10];
    const reliable = reorderPoint({ demandHistory: history, leadTimeDays: 5 });
    const unreliable = reorderPoint({
      demandHistory: history,
      leadTimeDays: 5,
      leadTimeSd: 3,
    });
    // Steady demand but an erratic supplier still needs a buffer.
    expect(reliable.safetyStock).toBeCloseTo(0, 6);
    expect(unreliable.safetyStock).toBeGreaterThan(10);
  });

  it("computes stockout risk from a Poisson demand model", () => {
    // Plenty of cover.
    expect(
      stockoutRisk({ currentStock: 100, dailyDemand: 1, daysUntilRestock: 7 }),
    ).toBeLessThan(0.001);
    // None at all.
    expect(
      stockoutRisk({ currentStock: 0, dailyDemand: 5, daysUntilRestock: 7 }),
    ).toBeGreaterThan(0.99);
    // Right at the average: the risk is close to half, which is the point.
    const atAverage = stockoutRisk({
      currentStock: 35,
      dailyDemand: 5,
      daysUntilRestock: 7,
    });
    expect(atAverage).toBeGreaterThan(0.4);
    expect(atAverage).toBeLessThan(0.6);
  });

  it("reports days of cover with the volatility beside it", () => {
    const steady = daysOfCover({
      currentStock: 100,
      demandHistory: [10, 10, 10, 10],
    });
    expect(steady.days).toBeCloseTo(10, 10);
    expect(steady.demandSd).toBeCloseTo(0, 10);

    const spiky = daysOfCover({
      currentStock: 100,
      demandHistory: [1, 30, 2, 7],
    });
    expect(spiky.demandSd).toBeGreaterThan(10);

    const dead = daysOfCover({ currentStock: 5, demandHistory: [0, 0, 0] });
    expect(dead.days).toBe(Number.POSITIVE_INFINITY);
    expect(dead.runsOut).toBeNull();
  });

  it("computes EOQ", () => {
    // sqrt(2*1000*50/2) = sqrt(50000) ~= 223.6
    expect(
      economicOrderQuantity({
        annualDemand: 1000,
        orderCost: 50,
        holdingCostPerUnitPerYear: 2,
      }),
    ).toBeCloseTo(223.6068, 3);
  });

  it("bands risk for a badge", () => {
    expect(riskBand(0.001)).toBe("none");
    expect(riskBand(0.1)).toBe("low");
    expect(riskBand(0.3)).toBe("elevated");
    expect(riskBand(0.8)).toBe("high");
  });
});
