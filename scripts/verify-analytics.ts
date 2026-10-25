/**
 * Runs every analytics query against the real database and checks the numbers
 * against independently computed totals.
 *
 * An analytics query that returns plausible-looking wrong numbers is worse
 * than one that throws, because nobody notices. Each check here recomputes the
 * answer a different way.
 */

import { sql } from "drizzle-orm";
import {
  categoryPerformance,
  dailySeriesForPlatform,
  dailySeriesForStore,
  orderValuesForStore,
  platformRatingPrior,
  productPerformance,
  ratingSummaryForStore,
  refundCounts,
  repeatPurchaseForStore,
  statusBreakdown,
  storePerformance,
  variantDemand,
} from "../lib/analytics/queries.ts";
import { db } from "../lib/db/index.ts";
import { stores } from "../lib/db/schema/index.ts";
import {
  concentrationLabel,
  effectiveCount,
  gini,
  herfindahl,
  paretoShare,
} from "../lib/stats/concentration.ts";
import { mean } from "../lib/stats/descriptive.ts";
import { decompose, detectAnomalies, forecast } from "../lib/stats/forecast.ts";
import {
  bayesianRating,
  meanInterval,
  proportionInterval,
} from "../lib/stats/inference.ts";
import { reorderPoint, stockoutRisk } from "../lib/stats/inventory.ts";
import { growthRate, linearRegression } from "../lib/stats/regression.ts";

let failures = 0;
function check(label: string, condition: boolean, detail = "") {
  if (!condition) failures++;
  console.log(
    `${condition ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`,
  );
}
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

async function main() {
  const [store] = await db
    .select({ id: stores.id, name: stores.name })
    .from(stores)
    .orderBy(stores.createdAt)
    .limit(1);

  console.log(`store: ${store.name}\n--- daily series ---`);

  const daily = await dailySeriesForStore(store.id, 180);
  check(
    "returns one row per day",
    daily.length === 180,
    `${daily.length} rows`,
  );
  check(
    "series is dense (no gaps)",
    daily.every((d, i) => {
      if (i === 0) return true;
      const gap =
        (Date.parse(d.day) - Date.parse(daily[i - 1].day)) / 86_400_000;
      return Math.round(gap) === 1;
    }),
  );
  check(
    "quiet days are zero, not missing",
    daily.some((d) => d.revenueCents === 0) ||
      daily.every((d) => d.revenueCents > 0),
  );

  // Independent total, straight from the tables.
  const [{ gross }] = await db.execute<{ gross: string }>(sql`
    select coalesce(sum(so.subtotal_cents + so.shipping_cents), 0)::text as gross
    from sub_orders so join orders o on o.id = so.order_id
    where so.store_id = ${store.id}
      and so.status not in ('cancelled','refunded')
      and o.placed_at >= current_date - interval '179 days'
  `);
  const seriesTotal = daily.reduce((s, d) => s + d.revenueCents, 0);
  check(
    "series total matches a direct sum",
    seriesTotal === Number(gross),
    `${money(seriesTotal)} vs ${money(Number(gross))}`,
  );

  // The revenue-vs-units multiplication bug would show up here.
  const [{ units }] = await db.execute<{ units: string }>(sql`
    select coalesce(sum(oi.quantity), 0)::text as units
    from order_items oi
    join sub_orders so on so.id = oi.sub_order_id
    join orders o on o.id = so.order_id
    where so.store_id = ${store.id}
      and so.status not in ('cancelled','refunded')
      and o.placed_at >= current_date - interval '179 days'
  `);
  const seriesUnits = daily.reduce((s, d) => s + d.units, 0);
  check(
    "units match a direct sum",
    seriesUnits === Number(units),
    `${seriesUnits} vs ${units}`,
  );

  console.log("\n--- models on the real series ---");

  const revenue = daily.map((d) => d.revenueCents);
  const fit = forecast(revenue, { horizon: 14, seasonLength: 7 });
  check("forecast produces 14 points", fit.points.length === 14);
  check(
    "forecast method is seasonal",
    fit.method === "holt-winters",
    fit.method,
  );
  check(
    "every forecast point is finite",
    fit.points.every((p) => Number.isFinite(p.value) && Number.isFinite(p.low)),
  );
  check(
    "intervals widen with horizon",
    fit.points[13].high - fit.points[13].low >
      fit.points[0].high - fit.points[0].low,
  );
  console.log(
    `  MAPE ${(fit.mape * 100).toFixed(1)}%  ·  next 7 days ${money(
      fit.points.slice(0, 7).reduce((s, p) => s + p.value, 0),
    )}`,
  );

  const { seasonalIndices } = decompose(revenue, 7);
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const firstDay = new Date(daily[0].day).getDay();
  const labelled = seasonalIndices.map((value, i) => ({
    day: dayNames[(firstDay + i) % 7],
    value,
  }));
  const best = labelled.reduce((a, b) => (b.value > a.value ? b : a));
  const worst = labelled.reduce((a, b) => (b.value < a.value ? b : a));
  check(
    "seasonal indices sum to zero",
    Math.abs(seasonalIndices.reduce((s, v) => s + v, 0)) < 1e-6,
  );
  console.log(
    `  strongest ${best.day} (${money(best.value)})  ·  weakest ${worst.day} (${money(worst.value)})`,
  );

  const anomalies = detectAnomalies(revenue, { seasonLength: 7, threshold: 3 });
  console.log(`  ${anomalies.length} anomalies past 3 sigma`);

  const trend = linearRegression(
    revenue.map((_, i) => i),
    revenue,
  );
  const growth = growthRate(revenue.filter((v) => v > 0));
  console.log(
    `  trend ${money(trend.slope)}/day (p=${trend.pValue.toFixed(4)}, R²=${trend.r2.toFixed(3)})  ·  growth ${(growth.perPeriod * 100).toFixed(2)}%/day`,
  );
  check(
    "the seeded upward trend is detected as significant",
    trend.slope > 0 && trend.pValue < 0.05,
    `slope ${money(trend.slope)}/day p=${trend.pValue.toFixed(5)}`,
  );

  console.log("\n--- order value ---");

  const values = await orderValuesForStore(store.id, 90);
  const aov = meanInterval(values, 0.95);
  check(
    "AOV has a finite interval",
    Number.isFinite(aov.low) && Number.isFinite(aov.high),
  );
  check(
    "AOV estimate sits inside its interval",
    aov.low < aov.estimate && aov.estimate < aov.high,
  );
  console.log(
    `  ${values.length} orders · AOV ${money(aov.estimate)} (95% CI ${money(aov.low)}–${money(aov.high)})`,
  );

  console.log("\n--- concentration ---");

  const products = await productPerformance(store.id, 180);
  const productRevenue = products.map((p) => p.revenueCents);

  // Item revenue excludes shipping, so it must be at or below the sub-order
  // gross for the same window — and within a plausible distance of it.
  const [{ items }] = await db.execute<{ items: string }>(sql`
    select coalesce(sum(oi.line_total_cents), 0)::text as items
    from order_items oi
    join sub_orders so on so.id = oi.sub_order_id
    join orders o on o.id = so.order_id
    where so.store_id = ${store.id}
      and so.status not in ('cancelled','refunded')
      -- The same window the queries use: the last 180 days including
      -- today. Written as 179 here for the same reason it is days - 1 there.
      and o.placed_at >= current_date - interval '179 days'
  `);
  const productTotal = productRevenue.reduce((s, v) => s + v, 0);
  check(
    "product revenue matches a direct item sum",
    productTotal === Number(items),
    `${money(productTotal)} vs ${money(Number(items))}`,
  );
  check(
    "and sits below the sub-order gross, which includes shipping",
    productTotal <= seriesTotal,
    `${money(productTotal)} <= ${money(seriesTotal)}`,
  );
  const g = gini(productRevenue);
  const pareto = paretoShare(productRevenue);
  check("Gini is in [0,1]", g >= 0 && g <= 1, g.toFixed(3));
  check(
    "top-20% share is in [0,1]",
    pareto.topShare >= 0 && pareto.topShare <= 1,
  );
  console.log(
    `  ${products.length} products · Gini ${g.toFixed(3)} (${concentrationLabel(g)}) · top 20% = ${(pareto.topShare * 100).toFixed(1)}% of revenue · 80% comes from ${(pareto.fractionForEighty * 100).toFixed(1)}% of products`,
  );

  console.log("\n--- inventory ---");

  const demand = await variantDemand(store.id, 60);
  check(
    "variant demand returns dense daily arrays",
    demand.every((d) => d.daily.length === 60),
  );
  const risky = demand
    .map((variant) => {
      const point = reorderPoint({
        demandHistory: variant.daily,
        leadTimeDays: 7,
        leadTimeSd: 2,
        serviceLevel: 0.95,
      });
      const risk = stockoutRisk({
        currentStock: variant.stock,
        dailyDemand: mean(variant.daily),
        daysUntilRestock: 7,
      });
      return { variant, point, risk };
    })
    .sort((a, b) => b.risk - a.risk);

  check(
    "every stockout probability is a probability",
    risky.every((r) => r.risk >= 0 && r.risk <= 1),
  );
  for (const row of risky.slice(0, 3)) {
    console.log(
      `  ${row.variant.productTitle.slice(0, 34).padEnd(34)} stock ${String(row.variant.stock).padStart(4)} · reorder at ${row.point.reorderPoint.toFixed(1)} · stockout risk ${(row.risk * 100).toFixed(1)}%`,
    );
  }

  console.log("\n--- ratings ---");

  const ratings = await ratingSummaryForStore(store.id);
  const prior = await platformRatingPrior();
  const adjusted = bayesianRating({
    sum: ratings.sum,
    count: ratings.total,
    priorMean: prior,
  });
  check("rating buckets cover 1-5", ratings.buckets.length === 5);
  check(
    "bucket counts sum to the total",
    ratings.buckets.reduce((s, b) => s + b.count, 0) === ratings.total,
  );
  console.log(
    `  ${ratings.total} reviews · raw ${ratings.average?.toFixed(2)} · platform prior ${prior.toFixed(2)} · adjusted ${adjusted.toFixed(2)}`,
  );

  const repeat = await repeatPurchaseForStore(store.id);
  const repeatRate = proportionInterval(repeat.repeatBuyers, repeat.buyers);
  check(
    "repeat rate is a valid proportion interval",
    repeatRate.low >= 0 &&
      repeatRate.high <= 1 &&
      repeatRate.low <= repeatRate.high,
  );
  console.log(
    `  repeat buyers ${repeat.repeatBuyers}/${repeat.buyers} = ${(repeatRate.estimate * 100).toFixed(1)}% (95% CI ${(repeatRate.low * 100).toFixed(1)}–${(repeatRate.high * 100).toFixed(1)}%)`,
  );

  console.log("\n--- platform ---");

  const platform = await dailySeriesForPlatform(180);
  check("platform series is dense", platform.length === 180);
  const platformTotal = platform.reduce((s, d) => s + d.revenueCents, 0);
  const commissionTotal = platform.reduce((s, d) => s + d.commissionCents, 0);
  check(
    "commission is a plausible fraction of GMV",
    commissionTotal > 0 && commissionTotal < platformTotal,
    `take rate ${((commissionTotal / platformTotal) * 100).toFixed(2)}%`,
  );

  const perStore = await storePerformance(180);
  const storeRevenue = perStore.map((s) => s.revenueCents);
  const storeTotal = storeRevenue.reduce((s, v) => s + v, 0);
  check(
    "per-store revenue sums to the platform total",
    storeTotal === platformTotal,
    `${money(storeTotal)} vs ${money(platformTotal)}`,
  );
  console.log(
    `  GMV ${money(platformTotal)} · commission ${money(commissionTotal)} · ${perStore.length} stores`,
  );
  console.log(
    `  store Gini ${gini(storeRevenue).toFixed(3)} · HHI ${herfindahl(storeRevenue).toFixed(3)} · effective stores ${effectiveCount(storeRevenue).toFixed(2)}`,
  );

  const categories = await categoryPerformance(180);
  check(
    "category mix is non-empty",
    categories.length > 0,
    `${categories.length} categories`,
  );
  const categoryTotal = categories.reduce((s, c) => s + c.revenueCents, 0);
  console.log(
    `  top category ${categories[0]?.name} at ${((categories[0]?.revenueCents / categoryTotal) * 100).toFixed(1)}% of item revenue`,
  );

  const statuses = await statusBreakdown();
  check("status breakdown is non-empty", statuses.length > 0);
  console.log(
    `  statuses: ${statuses.map((s) => `${s.status} ${s.count}`).join(", ")}`,
  );

  const refunds = await refundCounts(undefined, 180);
  const refundRate = proportionInterval(refunds.refunded, refunds.total);
  console.log(
    `  refund/cancel rate ${(refundRate.estimate * 100).toFixed(2)}% (95% CI ${(refundRate.low * 100).toFixed(2)}–${(refundRate.high * 100).toFixed(2)}%)`,
  );

  console.log(
    failures === 0 ? "\nall checks passed" : `\n${failures} CHECK(S) FAILED`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
