import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DemandHeatMap, IntentHeatMap } from "@/components/analytics/heat-map";
import { Button } from "@/components/ui/button";
import {
  demandHeat,
  type HeatDimension,
  intentHeat,
} from "@/lib/analytics/heat";
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
  {
    key: "tag",
    label: "Tags",
    blurb: "Which themes buyers respond to.",
  },
];

/**
 * Demand heat, sliced four ways, plus intent against purchase.
 *
 * A separate page rather than another block on Analytics, which is already
 * long — but reached from there and sharing its palette and its queries, so it
 * is a section of that surface rather than a rival to it.
 *
 * Everything here is derived from what buyers did: bought, saved, basketed,
 * returned. Nothing counts views or clicks, because nothing records them — see
 * the note at the foot of the page, which says so on the page rather than only
 * in a comment, since a seller reading a "heat map" will reasonably assume it
 * includes browsing.
 */
export default async function HeatPage({
  params,
  searchParams,
}: PageProps<"/dashboard/[storeId]/analytics/heat">) {
  const { storeId } = await params;
  const query = await searchParams;

  await requireStorePermission(storeId, "report.sales.view");

  const raw = Array.isArray(query.by) ? query.by[0] : query.by;
  const dimension: HeatDimension =
    DIMENSIONS.find((entry) => entry.key === raw)?.key ?? "product";
  const weeks = 12;

  const [matrix, intent] = await Promise.all([
    demandHeat(storeId, dimension, weeks, 25),
    intentHeat(storeId, 90, 25),
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
          The last {weeks} weeks. Darker means more units sold that week.
        </p>
      </div>

      {/* Plain links, so a slice is a URL somebody can bookmark or send. */}
      <nav className="flex flex-wrap gap-1 border-border border-b pb-2">
        {DIMENSIONS.map((entry) => (
          <Link
            key={entry.key}
            href={`/dashboard/${storeId}/analytics/heat?by=${entry.key}`}
            aria-current={entry.key === dimension ? "page" : undefined}
            // Matching the range pills on Analytics exactly, rather than
            // inventing a second look for the same control.
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

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface-1 p-5">
        <div className="flex flex-col gap-1">
          <h2 className="font-medium">{active?.label} by week</h2>
          <p className="text-secondary-text text-sm">{active?.blurb}</p>
        </div>
        <DemandHeatMap matrix={matrix} />
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface-1 p-5">
        <div className="flex flex-col gap-1">
          <h2 className="font-medium">Wanted against bought</h2>
          <p className="text-secondary-text text-sm">
            The last 90 days. Where interest and sales disagree is where there
            is something to fix.
          </p>
        </div>
        <IntentHeatMap heat={intent} />
      </section>

      {/*
        Said out loud, because "heat map" sets an expectation this cannot meet
        yet and a seller should not have to discover the gap by wondering why
        their best-viewed product is missing.
      */}
      <p className="text-tertiary-text text-xs">
        These are built from what buyers did — bought, saved, basketed,
        returned. Page views and clicks are not counted anywhere, because
        nothing records them yet.
      </p>
    </div>
  );
}
