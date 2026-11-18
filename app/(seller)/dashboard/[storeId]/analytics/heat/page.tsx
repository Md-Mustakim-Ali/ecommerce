import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  DemandHeatMap,
  FunnelHeatMap,
  RankedHeat,
} from "@/components/analytics/heat-map";
import { Button } from "@/components/ui/button";
import { demandHeat, type HeatDimension } from "@/lib/analytics/heat";
import {
  behaviourHeat,
  clickHeat,
  funnelHeat,
} from "@/lib/analytics/heat-behaviour";
import { reportedProducts } from "@/lib/analytics/reports-heat";
import { requireStorePermission } from "@/lib/auth/access";

export const metadata: Metadata = { title: "Heat" };

const DIMENSIONS: { key: HeatDimension; label: string; blurb: string }[] = [
  {
    key: "product",
    label: "Products",
    blurb: "Which things move, and in which weeks.",
  },
  {
    key: "variant",
    label: "Variants",
    blurb: "Which size or colour is doing the work.",
  },
  {
    key: "category",
    label: "Categories",
    blurb: "Where your demand sits in the catalogue.",
  },
  { key: "tag", label: "Tags", blurb: "Which themes buyers respond to." },
];

/**
 * Everything this store can be measured by, in one place.
 *
 * Four demand grids, what people looked at, the funnel from view to purchase,
 * which controls get pressed, and what has been complained about.
 *
 * Two permissions rather than one. Sales figures are `report.sales.view`, which
 * the page requires; complaints are `report.view`, checked separately, so a
 * store can hand somebody the numbers without handing them the grievances.
 */
export default async function HeatPage({
  params,
  searchParams,
}: PageProps<"/dashboard/[storeId]/analytics/heat">) {
  const { storeId } = await params;
  const query = await searchParams;

  const access = await requireStorePermission(storeId, "report.sales.view");
  const canSeeReports = access.permissions.has("report.view");

  const raw = Array.isArray(query.by) ? query.by[0] : query.by;
  const dimension: HeatDimension =
    DIMENSIONS.find((entry) => entry.key === raw)?.key ?? "product";
  const weeks = 12;

  const [demand, views, funnel, clicks, complaints] = await Promise.all([
    demandHeat(storeId, dimension, weeks, 25),
    behaviourHeat(storeId, "product_view", weeks, 25),
    funnelHeat(storeId, 90, 25),
    clickHeat(storeId, 30, 15),
    canSeeReports ? reportedProducts(storeId, 180, 15) : Promise.resolve([]),
  ]);

  const active = DIMENSIONS.find((entry) => entry.key === dimension);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          render={<Link href={`/dashboard/${storeId}/analytics`} />}
        >
          <ArrowLeft aria-hidden className="size-4" />
          Analytics
        </Button>
      </div>

      <div className="flex flex-col gap-1">
        <h1 className="font-semibold text-xl tracking-tight">Heat</h1>
        <p className="text-secondary-text text-sm">
          The last {weeks} weeks. Darker means more.
        </p>
      </div>

      {/* Plain links, so a slice is a URL somebody can bookmark or send. */}
      <nav className="flex flex-wrap gap-1 border-border border-b pb-2">
        {DIMENSIONS.map((entry) => (
          <Link
            key={entry.key}
            href={`/dashboard/${storeId}/analytics/heat?by=${entry.key}`}
            aria-current={entry.key === dimension ? "page" : undefined}
            className={`rounded-full px-3 py-1.5 font-medium text-sm ${
              entry.key === dimension
                ? "bg-surface-3 text-primary-text"
                : "text-secondary-text hover:bg-surface-2"
            }`}
          >
            {entry.label}
          </Link>
        ))}
      </nav>

      <Section title={`${active?.label} sold by week`} blurb={active?.blurb}>
        <DemandHeatMap matrix={demand} />
      </Section>

      <Section
        title="Looked at by week"
        blurb="People who opened each product page. Counts people, not page loads — one person refreshing six times is one."
      >
        <DemandHeatMap matrix={views} />
      </Section>

      <Section
        title="From looking to buying"
        blurb="The last 90 days. Where the drop happens tells you which problem it is."
      >
        <FunnelHeatMap heat={funnel} />
      </Section>

      <Section
        title="What gets pressed"
        blurb="The last 30 days. Only controls somebody marked worth counting."
      >
        <RankedHeat
          rows={clicks.map((row) => ({
            label: row.label,
            value: row.clicks,
            secondary: row.people,
          }))}
          unit="clicks"
          secondaryLabel="people"
        />
      </Section>

      {canSeeReports ? (
        <Section
          title="Complained about"
          blurb="The last 180 days. Open ones are still with the platform."
        >
          <RankedHeat
            rows={complaints.map((row) => ({
              label: `${row.label} · ${Object.keys(row.reasons).join(", ")}`,
              value: row.total,
              secondary: row.open,
            }))}
            unit="reports"
            secondaryLabel="open"
          />
        </Section>
      ) : null}
    </div>
  );
}

function Section({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface-1 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium">{title}</h2>
        {blurb ? <p className="text-secondary-text text-sm">{blurb}</p> : null}
      </div>
      {children}
    </section>
  );
}
