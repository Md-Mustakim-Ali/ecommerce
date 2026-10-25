"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import Image from "next/image";
import Link from "next/link";
import { useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money/format";

export type ProductRow = {
  id: string;
  slug: string;
  title: string;
  status: "active" | "draft" | "archived";
  brandName: string | null;
  imageUrl: string | null;
  variantCount: number;
  stock: number;
  minPriceCents: number;
  maxPriceCents: number;
};

const STATUS_BADGE = {
  active: { label: "Live", variant: "positive" as const },
  draft: { label: "Draft", variant: "neutral" as const },
  archived: { label: "Archived", variant: "critical" as const },
};

/**
 * Past this many rows the list is windowed instead of rendered whole.
 *
 * The storefront grid is not virtualized and does not need to be — it is
 * paginated at 24. This list is not paginated, because a seller reorganising
 * their catalogue wants to scan all of it, and a store with eight hundred
 * listings would otherwise put eight hundred rows and eight hundred thumbnails
 * into the document at once.
 *
 * 60 is roughly three screens. Below that, windowing costs more than it saves:
 * it forces a fixed row height and a scroll container, and both are worse than
 * simply rendering the rows.
 */
const VIRTUALIZE_ABOVE = 60;

/** Fixed, because the row markup is fixed. Measured from the rendered list. */
const ROW_HEIGHT = 69;

export function ProductRows({
  storeId,
  rows,
  canEdit,
}: {
  storeId: string;
  rows: ProductRow[];
  canEdit: boolean;
}) {
  if (rows.length <= VIRTUALIZE_ABOVE) {
    return (
      <ul className="flex flex-col gap-px overflow-hidden rounded-md bg-border">
        {rows.map((row) => (
          <li key={row.id}>
            <Row storeId={storeId} row={row} canEdit={canEdit} />
          </li>
        ))}
      </ul>
    );
  }

  return <VirtualRows storeId={storeId} rows={rows} canEdit={canEdit} />;
}

function VirtualRows({
  storeId,
  rows,
  canEdit,
}: {
  storeId: string;
  rows: ProductRow[];
  canEdit: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    // Three rows either side. Enough that a flick-scroll does not reach the
    // edge of what has been rendered before React catches up.
    overscan: 3,
  });

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={scrollRef}
        // A fixed height is what makes windowing possible at all: the container
        // has to scroll, not the page.
        className="max-h-[70dvh] overflow-y-auto overscroll-contain rounded-md bg-border"
      >
        <ul
          className="relative flex flex-col"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            return (
              <li
                key={row.id}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0 w-full"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <Row storeId={storeId} row={row} canEdit={canEdit} />
              </li>
            );
          })}
        </ul>
      </div>
      <p className="text-tertiary-text text-xs">
        {rows.length} rows, windowed. Scroll inside the list.
      </p>
    </div>
  );
}

function Row({
  storeId,
  row,
  canEdit,
}: {
  storeId: string;
  row: ProductRow;
  canEdit: boolean;
}) {
  const badge = STATUS_BADGE[row.status];
  const priceRange =
    row.minPriceCents === row.maxPriceCents
      ? formatMoney(row.minPriceCents, "USD")
      : `${formatMoney(row.minPriceCents, "USD")} – ${formatMoney(row.maxPriceCents, "USD")}`;

  return (
    <Link
      href={
        canEdit ? `/dashboard/${storeId}/products/${row.id}` : `/p/${row.slug}`
      }
      className="flex items-center gap-4 border-border border-b bg-surface-1 px-4 py-3 hover:bg-surface-2"
    >
      {row.imageUrl ? (
        <Image
          src={row.imageUrl}
          alt=""
          width={44}
          height={44}
          className="size-11 shrink-0 rounded-md object-cover"
        />
      ) : (
        <span className="size-11 shrink-0 rounded-md bg-surface-3" />
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium text-sm">{row.title}</span>
        <span className="truncate text-secondary-text text-xs">
          {row.brandName ? `${row.brandName} · ` : ""}
          {row.variantCount} {row.variantCount === 1 ? "variant" : "variants"} ·{" "}
          {row.stock} in stock
        </span>
      </div>

      <span className="tabular hidden shrink-0 text-sm sm:block">
        {priceRange}
      </span>
      <Badge variant={badge.variant}>{badge.label}</Badge>
    </Link>
  );
}
