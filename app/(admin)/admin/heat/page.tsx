import type { Metadata } from "next";
import {
  DemandHeatMap,
  FunnelHeatMap,
  RankedHeat,
} from "@/components/analytics/heat-map";
import {
  behaviourHeat,
  clickHeat,
  funnelHeat,
  searchHeat,
} from "@/lib/analytics/heat-behaviour";
import { reportedStores } from "@/lib/analytics/reports-heat";
import { requirePlatformPermission } from "@/lib/auth/access";

export const metadata: Metadata = { title: "Heat" };

/**
 * The same grids as a seller sees, with the store filter taken off.
 *
 * Literally the same functions — every query takes a nullable storeId, and null
 * means the platform. Writing an admin copy of each would mean two definitions
 * of "a view" drifting apart until the platform total stopped equalling the sum
 * of the stores.
 *
 * What is here and not on a seller's page is the part that only makes sense
 * across stores: what people search for, which is scoped to no seller, and
 * which sellers attract complaints, which no seller should see about anyone
 * else.
 */
export default async function AdminHeatPage() {
  await requirePlatformPermission("platform.order.view");

  const [views, funnel, searches, clicks, sellers] = await Promise.all([
    behaviourHeat(null, "product_view", 12, 25),
    funnelHeat(null, 90, 25),
    searchHeat(14, 20),
    clickHeat(null, 30, 20),
    reportedStores(180, 20),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-semibold text-xl tracking-tight">Heat</h1>
        <p className="text-secondary-text text-sm">
          Across every store. Darker means more.
        </p>
      </div>

      <Section
        title="Most looked at, by week"
        blurb="People who opened each product page, platform-wide. Counts people, not page loads."
      >
        <DemandHeatMap matrix={views} />
      </Section>

      <Section
        title="From looking to buying"
        blurb="The last 90 days, every store. Where the drop happens says which problem the platform has."
      >
        <FunnelHeatMap heat={funnel} />
      </Section>

      <Section
        title="What people search for"
        blurb="The last 14 days. Bounded by how long raw events are kept — the terms live on the event, not in a daily counter."
      >
        <RankedHeat
          rows={searches.map((row) => ({
            label: row.term,
            value: row.people,
            secondary: row.searches,
          }))}
          unit="people"
          secondaryLabel="searches"
        />
      </Section>

      <Section
        title="What gets pressed"
        blurb="The last 30 days, across the whole shop."
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

      <Section
        title="Sellers by complaints upheld"
        blurb="The last 180 days, ranked on upheld rather than on volume — a busy shop attracts complaints the way a busy road attracts litter."
      >
        <RankedHeat
          rows={sellers.map((row) => ({
            label: `${row.name} · ${row.total} total, ${row.dismissed} dismissed`,
            value: row.upheld,
            secondary: row.open,
          }))}
          unit="upheld"
          secondaryLabel="open"
        />
      </Section>
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
