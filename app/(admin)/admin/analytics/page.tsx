import type { Metadata } from "next";
import Link from "next/link";
import {
  LorenzChart,
  RankedBarChart,
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
  categoryPerformance,
  dailySeriesForPlatform,
  platformRatingPrior,
  refundCounts,
  statusBreakdown,
  storePerformance,
} from "@/lib/analytics/queries";
import { requirePlatformPermission } from "@/lib/auth/access";
import { formatMoney } from "@/lib/money/format";
import {
  concentrationLabel,
  effectiveCount,
  gini,
  herfindahl,
  lorenzCurve,
  paretoShare,
} from "@/lib/stats/concentration";
import {
  decompose,
  detectAnomalies,
  forecast,
  movingAverage,
} from "@/lib/stats/forecast";
import { bayesianRating, proportionInterval } from "@/lib/stats/inference";
import { growthRate, linearRegression } from "@/lib/stats/regression";

export const metadata: Metadata = { title: "Analytics" };

const RANGES = [30, 90, 180, 365] as const;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pct = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;

/**
 * Platform analytics.
 *
 * The same models as the seller view, one level up. The questions differ: a
 * seller asks which of their products carries the business, the platform asks
 * which of its stores does — and the answer matters more here, because a
 * marketplace whose GMV depends on two sellers is a marketplace with two
 * points of failure.
 *
 * The panel chrome stays stock monochrome shadcn. The charts themselves use
 * the validated categorical palette: five series rendered in five greys is
 * not a monochrome dashboard, it is an unreadable one.
 */
export default async function AdminAnalyticsPage({
  searchParams,
}: PageProps<"/admin/analytics">) {
  const query = await searchParams;
  const access = await requirePlatformPermission("platform.finance.report");

  const rawRange = Array.isArray(query.range) ? query.range[0] : query.range;
  const days = RANGES.find((r) => String(r) === rawRange) ?? 180;

  const [daily, perStore, categories, statuses, refunds, prior] =
    await Promise.all([
      dailySeriesForPlatform(days),
      storePerformance(days),
      categoryPerformance(days),
      statusBreakdown(),
      refundCounts(undefined, days),
      platformRatingPrior(),
    ]);

  const revenue = daily.map((d) => d.revenueCents);
  const gmv = revenue.reduce((s, v) => s + v, 0);
  const commission = daily.reduce((s, d) => s + d.commissionCents, 0);
  const orders = daily.reduce((s, d) => s + d.orders, 0);
  const takeRate = gmv === 0 ? 0 : commission / gmv;

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
  const seasonality = seasonalIndices
    .map((value, index) => ({
      day: DAY_NAMES[(firstDayOfWeek + index) % 7],
      value,
    }))
    .sort((a, b) => DAY_NAMES.indexOf(a.day) - DAY_NAMES.indexOf(b.day));

  const storeRevenue = perStore.map((s) => s.revenueCents);
  const g = gini(storeRevenue);
  const hhi = herfindahl(storeRevenue);
  const effective = effectiveCount(storeRevenue);
  const pareto = paretoShare(storeRevenue);
  const lorenz = lorenzCurve(storeRevenue).map((point) => ({
    ...point,
    equality: point.population,
  }));

  const refundRate = proportionInterval(refunds.refunded, refunds.total);

  const ranked = perStore
    .map((store) => ({
      ...store,
      share: gmv === 0 ? 0 : store.revenueCents / gmv,
      adjustedRating:
        store.ratingCount === 0
          ? null
          : bayesianRating({
              sum: (store.ratingAverage ?? 0) * store.ratingCount,
              count: store.ratingCount,
              priorMean: prior,
            }),
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents);

  const forecastNext7 = fit.points.slice(0, 7).reduce((s, p) => s + p.value, 0);
  const statusTotal = statuses.reduce((s, row) => s + row.count, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-semibold text-xl tracking-tight">Analytics</h1>
          <p className="text-muted-foreground text-sm">
            Whole platform · last {days} days
          </p>
        </div>
        <Link
          href="/admin"
          className="text-muted-foreground text-sm hover:underline"
        >
          Back to admin
        </Link>
      </div>

      <nav className="flex flex-wrap gap-1 border-border border-b pb-2">
        {RANGES.map((range) => (
          <Link
            key={range}
            href={`/admin/analytics?range=${range}`}
            aria-current={range === days ? "page" : undefined}
            className={`rounded-full px-3 py-1.5 font-medium text-sm ${
              range === days
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {range} days
          </Link>
        ))}
      </nav>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="GMV"
          value={formatMoney(gmv, "USD")}
          delta={
            periodDelta === null
              ? null
              : { value: periodDelta, label: "vs. first half" }
          }
          hint={`${orders} sub-orders`}
        />
        <StatTile
          label="Commission"
          value={formatMoney(commission, "USD")}
          hint={`${pct(takeRate, 2)} take rate`}
        />
        <StatTile
          label="Effective stores"
          value={effective.toFixed(2)}
          hint={`of ${perStore.length} — 1/HHI, so it counts weight not headcount`}
        />
        <StatTile
          label="Refunded or cancelled"
          value={refunds.total === 0 ? "—" : pct(refundRate.estimate, 2)}
          interval={
            refunds.total === 0
              ? null
              : `${pct(refundRate.low, 2)} – ${pct(refundRate.high, 2)}`
          }
          hint={`${refunds.refunded} of ${refunds.total}`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>GMV and forecast</CardTitle>
          <CardDescription>
            Holt-Winters with a damped trend and a weekly cycle. The band is a
            90% prediction interval.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <RevenueForecastChart data={chartData} height={280} />

          <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col">
              <dt className="text-muted-foreground">Next 7 days</dt>
              <dd className="font-medium tabular-nums">
                {formatMoney(Math.round(forecastNext7), "USD")}
              </dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-muted-foreground">Trend</dt>
              <dd className="font-medium tabular-nums">
                {formatMoney(Math.round(trend.slope), "USD")}/day
                <span className="ml-1.5 font-normal text-muted-foreground">
                  {trend.pValue < 0.05
                    ? `p=${trend.pValue.toFixed(3)}`
                    : `not significant`}
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
              <dt className="text-muted-foreground">Unusual days</dt>
              <dd className="font-medium tabular-nums">{anomalies.length}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Seller concentration</CardTitle>
            <CardDescription>
              Gini {g.toFixed(3)} — {concentrationLabel(g)}. HHI{" "}
              {(hhi * 10_000).toFixed(0)} on the competition-authority scale.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <LorenzChart data={lorenz} />
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Top 20% of stores</dt>
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

        <Card>
          <CardHeader>
            <CardTitle>Weekly pattern</CardTitle>
            <CardDescription>
              How much more or less a weekday makes than an ordinary day, with
              the trend removed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SeasonalityChart data={seasonality} height={220} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Category mix</CardTitle>
            <CardDescription>
              Item revenue by top-level category, rolled up from the leaf a
              product actually sits on.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {categories.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing sold yet.</p>
            ) : (
              <RankedBarChart
                data={categories.map((c) => ({
                  name: c.name,
                  value: c.revenueCents,
                }))}
                height={200}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Where orders sit</CardTitle>
            <CardDescription>
              Last 90 days, by sub-order status.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Share</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statuses
                  .sort((a, b) => b.count - a.count)
                  .map((row) => (
                    <TableRow key={row.status}>
                      <TableCell className="capitalize">{row.status}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.count}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {statusTotal === 0 ? "—" : pct(row.count / statusTotal)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(row.grossCents, "USD")}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Stores</CardTitle>
          <CardDescription>
            Adjusted rating shrinks a thin review count toward the platform mean
            of {prior.toFixed(2)}, so a store with three five-star reviews does
            not outrank one with nine hundred.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Store</TableHead>
                <TableHead className="text-right">GMV</TableHead>
                <TableHead className="text-right">Share</TableHead>
                <TableHead className="text-right">Commission</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">Rating</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ranked.map((store) => (
                <TableRow key={store.storeId}>
                  <TableCell>
                    <Link
                      href={`/store/${store.slug}`}
                      className="hover:underline"
                    >
                      {store.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(store.revenueCents, "USD")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {pct(store.share)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(store.commissionCents, "USD")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {store.orders}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {store.adjustedRating === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <>
                        {store.adjustedRating.toFixed(2)}
                        <span className="ml-1.5 text-muted-foreground text-xs">
                          ({store.ratingCount})
                        </span>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {!access.permissions.has("platform.ledger.view") ? (
        <p className="text-muted-foreground text-xs">
          <Badge variant="outline">Restricted</Badge> Individual ledger entries
          need the ledger permission.
        </p>
      ) : null}
    </div>
  );
}
