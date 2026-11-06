import { eq } from "drizzle-orm";
import { AlertTriangle, TrendingUp } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  LorenzChart,
  RankedBarChart,
  RatingHistogram,
  RevenueForecastChart,
  SeasonalityChart,
} from "@/components/analytics/charts";
import { StatTile } from "@/components/analytics/stat-tile";
import { Badge } from "@/components/analytics/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/analytics/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/analytics/ui/table";
import {
  dailySeriesForStore,
  orderValuesForStore,
  platformRatingPrior,
  productPerformance,
  ratingSummaryForStore,
  refundCounts,
  repeatPurchaseForStore,
  variantDemand,
} from "@/lib/analytics/queries";
import { requireStorePermission } from "@/lib/auth/access";
import { db } from "@/lib/db";
import { stores } from "@/lib/db/schema";
import { PLATFORM_CURRENCY } from "@/lib/money/currency";
import { formatMoney } from "@/lib/money/format";
import {
  concentrationLabel,
  gini,
  lorenzCurve,
  paretoShare,
} from "@/lib/stats/concentration";
import { mean } from "@/lib/stats/descriptive";
import {
  decompose,
  detectAnomalies,
  forecast,
  movingAverage,
} from "@/lib/stats/forecast";
import {
  bayesianRating,
  meanInterval,
  proportionInterval,
} from "@/lib/stats/inference";
import { reorderPoint, riskBand, stockoutRisk } from "@/lib/stats/inventory";
import { growthRate, linearRegression } from "@/lib/stats/regression";

export const metadata: Metadata = { title: "Analytics" };

const RANGES = [30, 90, 180, 365] as const;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pct = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;

/**
 * Seller analytics.
 *
 * Gated on `report.sales.view`, with the inventory and rating sections gated
 * separately — a bookkeeper who can see revenue has no reason to be looking at
 * reorder points.
 *
 * The models come from lib/stats and are applied to a dense daily series, so
 * every figure here is reproducible from the same functions the tests check
 * against published values. Where a number is an estimate it carries an
 * interval; where a model is fitting badly the page says so rather than
 * rendering a confident line over noise.
 */
export default async function StoreAnalyticsPage({
  params,
  searchParams,
}: PageProps<"/dashboard/[storeId]/analytics">) {
  const { storeId } = await params;
  const query = await searchParams;

  const access = await requireStorePermission(storeId, "report.sales.view");

  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
    columns: { name: true },
  });
  if (!store) notFound();

  const rawRange = Array.isArray(query.range) ? query.range[0] : query.range;
  const days = RANGES.find((r) => String(r) === rawRange) ?? 180;

  const canSeeInventory = access.permissions.has("inventory.update");

  const [
    daily,
    orderValues,
    products,
    ratings,
    prior,
    repeat,
    refunds,
    demand,
  ] = await Promise.all([
    dailySeriesForStore(storeId, days),
    orderValuesForStore(storeId, days),
    productPerformance(storeId, days),
    ratingSummaryForStore(storeId),
    platformRatingPrior(),
    repeatPurchaseForStore(storeId, days),
    refundCounts(storeId, days),
    canSeeInventory ? variantDemand(storeId, 60) : Promise.resolve([]),
  ]);

  const revenue = daily.map((d) => d.revenueCents);
  const totalRevenue = revenue.reduce((s, v) => s + v, 0);
  const totalOrders = daily.reduce((s, d) => s + d.orders, 0);

  // Split the window in half and compare, which is the honest version of the
  // "vs. last period" number every dashboard shows.
  const half = Math.floor(revenue.length / 2);
  const firstHalf = revenue.slice(0, half).reduce((s, v) => s + v, 0);
  const secondHalf = revenue.slice(half).reduce((s, v) => s + v, 0);
  const periodDelta =
    firstHalf === 0 ? null : ((secondHalf - firstHalf) / firstHalf) * 100;

  const fit = forecast(revenue, {
    horizon: 14,
    seasonLength: 7,
    confidence: 0.9,
  });
  const smoothed = movingAverage(revenue, 7);
  const { seasonalIndices } = decompose(revenue, 7);
  const anomalies = detectAnomalies(revenue, { seasonLength: 7, threshold: 3 });
  const trend = linearRegression(
    revenue.map((_, i) => i),
    revenue,
  );
  const growth = growthRate(revenue);

  // History and forecast in one array so the chart draws a continuous line.
  const chartData = [
    ...daily.map((point, index) => ({
      day: point.day,
      actual: point.revenueCents,
      trend: smoothed[index],
      forecast: null,
      band: null as [number, number] | null,
    })),
    ...fit.points.map((point) => {
      const date = new Date(daily[daily.length - 1].day);
      date.setDate(date.getDate() + point.horizon);
      return {
        day: date.toISOString().slice(0, 10),
        actual: null,
        trend: null,
        forecast: point.value,
        band: [Math.max(0, point.low), point.high] as [number, number],
      };
    }),
  ];

  const firstDayOfWeek = new Date(daily[0].day).getDay();
  const seasonality = seasonalIndices.map((value, index) => ({
    day: DAY_NAMES[(firstDayOfWeek + index) % 7],
    value,
  }));
  // Rotated so the chart always reads Sunday-first, whatever day the window
  // happens to start on.
  seasonality.sort(
    (a, b) => DAY_NAMES.indexOf(a.day) - DAY_NAMES.indexOf(b.day),
  );

  const aov = meanInterval(orderValues, 0.95);
  const repeatRate = proportionInterval(repeat.repeatBuyers, repeat.buyers);
  const refundRate = proportionInterval(refunds.refunded, refunds.total);

  const productRevenue = products.map((p) => p.revenueCents);
  const g = gini(productRevenue);
  const pareto = paretoShare(productRevenue);
  const lorenz = lorenzCurve(productRevenue).map((point) => ({
    ...point,
    equality: point.population,
  }));

  const adjustedRating = bayesianRating({
    sum: ratings.sum,
    count: ratings.total,
    priorMean: prior,
  });

  const stockRisk = demand
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
      return { variant, point, risk, band: riskBand(risk) };
    })
    .filter((row) => row.band !== "none")
    .sort((a, b) => b.risk - a.risk)
    .slice(0, 10);

  const topProducts = products
    .filter((p) => p.revenueCents > 0)
    .slice(0, 8)
    .map((p) => ({ name: p.title, value: p.revenueCents }));

  const forecastNext7 = fit.points.slice(0, 7).reduce((s, p) => s + p.value, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-semibold text-xl tracking-tight">Analytics</h1>
          <p className="text-secondary-text text-sm">
            {store.name} · last {days} days
          </p>
        </div>
        <Link
          href={`/dashboard/${storeId}`}
          className="text-secondary-text text-sm hover:underline"
        >
          Back to store
        </Link>
      </div>

      {/* Range is a link, not client state, so a view stays bookmarkable. */}
      <nav className="flex flex-wrap gap-1 border-border border-b pb-2">
        {RANGES.map((range) => (
          <Link
            key={range}
            href={`/dashboard/${storeId}/analytics?range=${range}`}
            aria-current={range === days ? "page" : undefined}
            className={`rounded-full px-3 py-1.5 font-medium text-sm ${
              range === days
                ? "bg-surface-3 text-primary-text"
                : "text-secondary-text hover:bg-surface-2"
            }`}
          >
            {range} days
          </Link>
        ))}
      </nav>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Revenue"
          value={formatMoney(totalRevenue, PLATFORM_CURRENCY)}
          delta={
            periodDelta === null
              ? null
              : { value: periodDelta, label: "vs. first half" }
          }
          hint={`${totalOrders} orders`}
        />
        <StatTile
          label="Average order value"
          value={formatMoney(Math.round(aov.estimate), PLATFORM_CURRENCY)}
          interval={
            Number.isFinite(aov.low)
              ? `${formatMoney(Math.round(aov.low), PLATFORM_CURRENCY)} – ${formatMoney(Math.round(aov.high), PLATFORM_CURRENCY)}`
              : null
          }
          hint={`from ${orderValues.length} orders`}
        />
        <StatTile
          label="Repeat buyers"
          value={repeat.buyers === 0 ? "—" : pct(repeatRate.estimate)}
          interval={
            repeat.buyers === 0
              ? null
              : `${pct(repeatRate.low)} – ${pct(repeatRate.high)}`
          }
          hint={`${repeat.repeatBuyers} of ${repeat.buyers} buyers`}
        />
        <StatTile
          label="Refunded or cancelled"
          value={refunds.total === 0 ? "—" : pct(refundRate.estimate, 2)}
          interval={
            refunds.total === 0
              ? null
              : `${pct(refundRate.low, 2)} – ${pct(refundRate.high, 2)}`
          }
          hint={`${refunds.refunded} of ${refunds.total} orders`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Revenue and forecast</CardTitle>
          <CardDescription>
            Holt-Winters with a damped trend and a weekly cycle. The band is a
            90% prediction interval and widens with the horizon, which is what
            the uncertainty actually does.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <RevenueForecastChart data={chartData} />

          <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col">
              <dt className="text-muted-foreground">Next 7 days</dt>
              <dd className="font-medium tabular-nums">
                {formatMoney(Math.round(forecastNext7), PLATFORM_CURRENCY)}
              </dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-muted-foreground">Trend</dt>
              <dd className="font-medium tabular-nums">
                {formatMoney(Math.round(trend.slope), PLATFORM_CURRENCY)}/day
                <span className="ml-1.5 font-normal text-muted-foreground">
                  {trend.pValue < 0.05
                    ? `significant (p=${trend.pValue.toFixed(3)})`
                    : `not significant (p=${trend.pValue.toFixed(2)})`}
                </span>
              </dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-muted-foreground">Compound growth</dt>
              <dd className="font-medium tabular-nums">
                {Number.isFinite(growth.perPeriod)
                  ? `${(growth.perPeriod * 100).toFixed(2)}%/day`
                  : "—"}
              </dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-muted-foreground">Fit error (MAPE)</dt>
              <dd className="font-medium tabular-nums">
                {Number.isFinite(fit.mape) ? pct(fit.mape, 0) : "—"}
              </dd>
            </div>
          </dl>

          {/*
            Daily commerce data is spiky, so MAPE is routinely high even when
            the weekly total is forecast well. Saying so is better than letting
            someone read a single day's point forecast as a promise.
          */}
          {fit.mape > 0.5 ? (
            <p className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-secondary-text text-xs">
              <TrendingUp aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Daily revenue is volatile here, so individual days are hard to
                predict — read the weekly total rather than any one point.
              </span>
            </p>
          ) : null}

          {anomalies.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <p className="flex items-center gap-2 font-medium text-xs">
                <AlertTriangle
                  aria-hidden
                  className="size-3.5 text-[#fab219]"
                />
                {anomalies.length} unusual{" "}
                {anomalies.length === 1 ? "day" : "days"}
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {anomalies.slice(0, 6).map((anomaly) => (
                  <li key={anomaly.index}>
                    <Badge variant="outline" className="tabular-nums">
                      {new Date(daily[anomaly.index].day).toLocaleDateString(
                        "en-US",
                        { month: "short", day: "numeric" },
                      )}{" "}
                      {anomaly.direction === "high" ? "▲" : "▼"}{" "}
                      {formatMoney(anomaly.value, PLATFORM_CURRENCY)}
                    </Badge>
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground text-xs">
                Scored on what is left after trend and weekday are removed, so a
                busy Friday is not flagged just for being a Friday.
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Which day is actually better</CardTitle>
            <CardDescription>
              Additive seasonal indices: how much more or less a given weekday
              makes than an ordinary day, with the trend removed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SeasonalityChart data={seasonality} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>How concentrated the revenue is</CardTitle>
            <CardDescription>
              Gini {g.toFixed(3)} — {concentrationLabel(g)}. The gap from the
              dashed line is the exposure if a top listing stops selling.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <LorenzChart data={lorenz} />
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Top 20% of products</dt>
                <dd className="font-medium tabular-nums">
                  {Number.isFinite(pareto.topShare)
                    ? pct(pareto.topShare)
                    : "—"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">80% comes from</dt>
                <dd className="font-medium tabular-nums">
                  {Number.isFinite(pareto.fractionForEighty)
                    ? pct(pareto.fractionForEighty)
                    : "—"}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Best sellers</CardTitle>
            <CardDescription>Revenue over the window.</CardDescription>
          </CardHeader>
          <CardContent>
            {topProducts.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nothing sold in this window.
              </p>
            ) : (
              <RankedBarChart data={topProducts} height={240} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ratings</CardTitle>
            <CardDescription>
              Adjusted score shrinks a thin sample toward the platform average
              of {prior.toFixed(2)}, so one five-star review does not outrank a
              long record.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {ratings.total === 0 ? (
              <p className="text-muted-foreground text-sm">No reviews yet.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                  <span className="flex items-baseline gap-1.5">
                    <span className="font-semibold text-2xl tracking-tight">
                      {adjustedRating.toFixed(2)}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      adjusted
                    </span>
                  </span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    raw {ratings.average?.toFixed(2)} from {ratings.total}{" "}
                    reviews
                  </span>
                </div>
                <RatingHistogram
                  data={ratings.buckets.map((bucket) => ({
                    rating: `${bucket.rating}★`,
                    count: bucket.count,
                  }))}
                />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {canSeeInventory ? (
        <Card>
          <CardHeader>
            <CardTitle>What to reorder</CardTitle>
            <CardDescription>
              Reorder point is average demand over a 7-day lead time plus safety
              stock for a 95% service level, allowing for variation in both
              demand and lead time. Reordering at the average alone stocks out
              about half the time.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {stockRisk.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nothing at risk. Every moving item has cover for the next
                restock.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">In stock</TableHead>
                    <TableHead className="text-right">Daily demand</TableHead>
                    <TableHead className="text-right">Reorder at</TableHead>
                    <TableHead className="text-right">Stockout risk</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stockRisk.map((row) => (
                    <TableRow key={row.variant.variantId}>
                      <TableCell className="max-w-[18rem]">
                        <span className="block truncate">
                          {row.variant.productTitle}
                        </span>
                        {row.variant.sku ? (
                          <span className="block truncate text-muted-foreground text-xs">
                            {row.variant.sku}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.variant.stock}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.point.averageDemand.toFixed(2)}
                        <span className="text-muted-foreground">
                          {" ±"}
                          {row.point.demandSd.toFixed(2)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Math.ceil(row.point.reorderPoint)}
                      </TableCell>
                      <TableCell className="text-right">
                        {/* Colour never carries this alone: the number is
                            printed and the band is named. */}
                        <Badge
                          variant={
                            row.band === "high" ? "destructive" : "secondary"
                          }
                          className="tabular-nums"
                        >
                          {pct(row.risk)} {row.band}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
