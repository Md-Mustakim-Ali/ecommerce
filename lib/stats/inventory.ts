import { mean, standardDeviation } from "./descriptive";
import { normalQuantile, poissonCdf } from "./distributions";

/**
 * Inventory decisions under uncertain demand.
 *
 * The seller-facing question is "when do I reorder, and how many". Answering
 * it needs a demand distribution, not an average: reordering at the average
 * means running out roughly half the time, which is the single most common
 * inventory mistake and the reason safety stock exists at all.
 */

/**
 * Safety stock and reorder point for normally-distributed demand.
 *
 * The variance term has two parts because both demand and lead time vary:
 *
 *   sigma_LT = sqrt( L·sigma_d² + d²·sigma_L² )
 *
 * Dropping the second term — as most spreadsheet versions do — understates the
 * requirement badly whenever a supplier is unreliable, which is exactly when
 * safety stock matters.
 */
export function reorderPoint(input: {
  /** Historical demand per period, one entry per period. */
  demandHistory: readonly number[];
  /** Lead time in the same period units. */
  leadTimeDays: number;
  /** Standard deviation of lead time, if known. */
  leadTimeSd?: number;
  /** Probability of not stocking out during a cycle. */
  serviceLevel?: number;
}): {
  averageDemand: number;
  demandSd: number;
  safetyStock: number;
  reorderPoint: number;
  serviceLevel: number;
  z: number;
} {
  const serviceLevel = input.serviceLevel ?? 0.95;
  const leadTimeSd = input.leadTimeSd ?? 0;

  const averageDemand = mean(input.demandHistory);
  const demandSd =
    input.demandHistory.length > 1 ? standardDeviation(input.demandHistory) : 0;

  const z = normalQuantile(serviceLevel);

  const combinedVariance =
    input.leadTimeDays * demandSd ** 2 + averageDemand ** 2 * leadTimeSd ** 2;
  const sigmaLeadTime = Math.sqrt(Math.max(0, combinedVariance));

  const safetyStock = z * sigmaLeadTime;
  const cycleDemand = averageDemand * input.leadTimeDays;

  return {
    averageDemand,
    demandSd,
    safetyStock,
    reorderPoint: cycleDemand + safetyStock,
    serviceLevel,
    z,
  };
}

/**
 * Probability of stocking out before a restock arrives, under Poisson demand.
 *
 * Poisson rather than normal for low-volume items: demand for something that
 * sells twice a week is a count, it cannot be negative, and the normal
 * approximation assigns real probability to negative demand at those rates.
 *
 * The rule of thumb is that the normal is acceptable once lambda is past about
 * 20; below that this is the honest model.
 */
export function stockoutRisk(input: {
  currentStock: number;
  /** Average units sold per day. */
  dailyDemand: number;
  daysUntilRestock: number;
}): number {
  const lambda = input.dailyDemand * input.daysUntilRestock;
  if (lambda <= 0) return 0;
  // P(demand > stock) = 1 - P(demand <= stock).
  return 1 - poissonCdf(input.currentStock, lambda);
}

/**
 * Days of cover left at the current rate, and the date it runs out.
 *
 * Deliberately reported with the demand standard deviation beside it, because
 * "14 days of cover" from steady demand and from spiky demand call for
 * different decisions.
 */
export function daysOfCover(input: {
  currentStock: number;
  demandHistory: readonly number[];
}): {
  days: number;
  averageDemand: number;
  demandSd: number;
  runsOut: Date | null;
} {
  const averageDemand = mean(input.demandHistory);
  const demandSd =
    input.demandHistory.length > 1 ? standardDeviation(input.demandHistory) : 0;

  if (!(averageDemand > 0)) {
    return {
      days: Number.POSITIVE_INFINITY,
      averageDemand: 0,
      demandSd,
      runsOut: null,
    };
  }

  const days = input.currentStock / averageDemand;
  const runsOut = new Date();
  runsOut.setDate(runsOut.getDate() + Math.floor(days));

  return { days, averageDemand, demandSd, runsOut };
}

/**
 * Economic order quantity.
 *
 * The classic square-root formula. Its assumptions — constant demand, fixed
 * ordering cost, no quantity discounts — are never quite true, so this is a
 * starting point for a conversation rather than an instruction, and the UI
 * should say so.
 */
export function economicOrderQuantity(input: {
  annualDemand: number;
  orderCost: number;
  holdingCostPerUnitPerYear: number;
}): number {
  if (input.holdingCostPerUnitPerYear <= 0) return Number.NaN;
  return Math.sqrt(
    (2 * input.annualDemand * input.orderCost) /
      input.holdingCostPerUnitPerYear,
  );
}

/** A plain reading of a stockout probability, for a badge. */
export function riskBand(
  probability: number,
): "none" | "low" | "elevated" | "high" {
  if (!Number.isFinite(probability) || probability < 0.02) return "none";
  if (probability < 0.15) return "low";
  if (probability < 0.4) return "elevated";
  return "high";
}
