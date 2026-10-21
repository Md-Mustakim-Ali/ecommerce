"use client";

import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/analytics/ui/chart";
import { series } from "./palette";

/**
 * Chart components for the analytics screens.
 *
 * Built on shadcn's Recharts wrapper (Maia). Every one ships a hover layer,
 * because an HTML chart is interactive and a static picture of numbers wastes
 * the medium — a crosshair and tooltip on anything with a time axis, a
 * per-mark tooltip on bars.
 *
 * Deliberately never a dual axis. Two measures on different scales get two
 * charts or an index to a common base; a second y-scale lets the author choose
 * where the lines cross, which is the most common way a chart lies.
 */

const money = (cents: number) =>
  `$${Math.round(cents / 100).toLocaleString("en-US")}`;

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * Actual against forecast, with the prediction band behind it.
 *
 * The band is the point: a forecast line drawn alone invites planning against
 * a single number the model does not believe. History and forecast are one
 * continuous series with a divider at the boundary rather than two, so the
 * join reads as a continuation instead of a comparison.
 */
export function RevenueForecastChart({
  data,
  height = 260,
}: {
  data: {
    day: string;
    actual: number | null;
    trend: number | null;
    forecast: number | null;
    band: [number, number] | null;
  }[];
  height?: number;
}) {
  const firstForecast = data.findIndex((d) => d.forecast !== null);

  return (
    <ChartContainer
      config={{
        actual: series(0, "Actual"),
        trend: series(2, "7-day average"),
        forecast: series(1, "Forecast"),
      }}
      className="w-full"
      style={{ height }}
    >
      <ComposedChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} strokeDasharray="2 4" />
        <XAxis
          dataKey="day"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={40}
          tickFormatter={shortDate}
        />
        {/* Anchored at zero. Revenue cannot be negative, and a truncated
            baseline exaggerates every change on the chart. */}
        <YAxis
          domain={[0, "auto"]}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={52}
          tickFormatter={money}
        />

        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(value) => shortDate(String(value))}
              formatter={(value, name) => [
                `${money(Number(value))} `,
                String(name),
              ]}
            />
          }
        />

        {/* The band is drawn first so the lines sit on top of it. */}
        <Area
          dataKey="band"
          stroke="none"
          fill="var(--color-forecast)"
          fillOpacity={0.14}
          isAnimationActive={false}
          connectNulls
        />

        <Line
          dataKey="actual"
          stroke="var(--color-actual)"
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          dataKey="trend"
          stroke="var(--color-trend)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          dataKey="forecast"
          stroke="var(--color-forecast)"
          strokeWidth={2}
          strokeDasharray="4 3"
          dot={false}
          isAnimationActive={false}
          connectNulls
        />

        {firstForecast > 0 ? (
          <ReferenceLine
            x={data[firstForecast].day}
            stroke="var(--muted-foreground)"
            strokeDasharray="3 3"
            label={{
              value: "forecast",
              position: "insideTopRight",
              fontSize: 10,
              fill: "var(--muted-foreground)",
            }}
          />
        ) : null}

        <ChartLegend content={<ChartLegendContent />} />
      </ComposedChart>
    </ChartContainer>
  );
}

/**
 * Weekday seasonal indices from the decomposition.
 *
 * Diverging around zero, because that is what an additive seasonal index is:
 * how much better or worse than an ordinary day. A bar chart anchored at zero
 * is the honest form; anchoring it at the minimum would make the weakest day
 * look like nothing happens on it.
 */
export function SeasonalityChart({
  data,
  height = 200,
}: {
  data: { day: string; value: number }[];
  height?: number;
}) {
  return (
    <ChartContainer
      config={{ value: series(0, "vs. an average day") }}
      className="w-full"
      style={{ height }}
    >
      <BarChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} strokeDasharray="2 4" />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={56}
          tickFormatter={money}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) => [
                `${Number(value) >= 0 ? "+" : ""}${money(Number(value))} `,
                "vs. an average day",
              ]}
            />
          }
        />
        <ReferenceLine y={0} stroke="var(--border)" />
        <Bar dataKey="value" radius={4} fill="var(--color-value)" />
      </BarChart>
    </ChartContainer>
  );
}

/**
 * The Lorenz curve, with the equality diagonal for reference.
 *
 * A top-ten list cannot answer "how exposed am I if one product stops
 * selling"; ten rows look much the same whether they are 20% of revenue or
 * 95%. The gap between the curve and the diagonal is exactly that answer, and
 * its area is half the Gini printed beside it.
 */
export function LorenzChart({
  data,
  height = 220,
}: {
  data: { population: number; value: number; equality: number }[];
  height?: number;
}) {
  const percent = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <ChartContainer
      config={{
        value: series(0, "Share of revenue"),
        equality: series(3, "If it were even"),
      }}
      className="w-full"
      style={{ height }}
    >
      <ComposedChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid strokeDasharray="2 4" />
        <XAxis
          dataKey="population"
          type="number"
          domain={[0, 1]}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={percent}
        />
        <YAxis
          type="number"
          domain={[0, 1]}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={44}
          tickFormatter={percent}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(value) => `Top ${percent(Number(value))}`}
              formatter={(value, name) => [
                `${percent(Number(value))} `,
                String(name),
              ]}
            />
          }
        />
        <Area
          dataKey="value"
          stroke="var(--color-value)"
          strokeWidth={2}
          fill="var(--color-value)"
          fillOpacity={0.12}
          isAnimationActive={false}
        />
        <Line
          dataKey="equality"
          stroke="var(--color-equality)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          dot={false}
          isAnimationActive={false}
        />
        <ChartLegend content={<ChartLegendContent />} />
      </ComposedChart>
    </ChartContainer>
  );
}

/** A plain horizontal magnitude comparison. One series, so no legend. */
export function RankedBarChart({
  data,
  height = 220,
  valueLabel = "Revenue",
}: {
  data: { name: string; value: number }[];
  height?: number;
  valueLabel?: string;
}) {
  return (
    <ChartContainer
      config={{ value: series(0, valueLabel) }}
      className="w-full"
      style={{ height }}
    >
      <BarChart
        data={data}
        layout="vertical"
        margin={{ left: 4, right: 16, top: 4 }}
      >
        <CartesianGrid horizontal={false} strokeDasharray="2 4" />
        <XAxis
          type="number"
          tickLine={false}
          axisLine={false}
          tickFormatter={money}
        />
        <YAxis
          type="category"
          dataKey="name"
          tickLine={false}
          axisLine={false}
          width={140}
          tickMargin={6}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) => [`${money(Number(value))} `, valueLabel]}
            />
          }
        />
        <Bar dataKey="value" radius={4} fill="var(--color-value)" />
      </BarChart>
    </ChartContainer>
  );
}

/** Rating histogram. Ordinal, so it keeps one hue rather than five. */
export function RatingHistogram({
  data,
  height = 180,
}: {
  data: { rating: string; count: number }[];
  height?: number;
}) {
  return (
    <ChartContainer
      config={{ count: series(0, "Reviews") }}
      className="w-full"
      style={{ height }}
    >
      <BarChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} strokeDasharray="2 4" />
        <XAxis
          dataKey="rating"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <YAxis tickLine={false} axisLine={false} width={36} tickMargin={8} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) => [`${value} `, "reviews"]}
            />
          }
        />
        <Bar dataKey="count" radius={4} fill="var(--color-count)" />
      </BarChart>
    </ChartContainer>
  );
}
