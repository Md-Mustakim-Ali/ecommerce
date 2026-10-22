import { BadgeCheck, PackageOpen, Store } from "lucide-react";
import Link from "next/link";
import { BlockRenderer } from "@/components/content/block-renderer";
import { ProductCard } from "@/components/shop/product-card";
import { Button } from "@/components/ui/button";
import type { ProductListItem } from "@/lib/catalog/queries";
import type { ResolvedPlacement } from "@/lib/content/queries";
import { cn } from "@/lib/utils";

/**
 * How far into the grid the first offer card sits, and how far apart the rest
 * are.
 *
 * Never first: the buyer came for products, and a grid that opens with an
 * advert is one they learn to scroll past. Four is a full row at the widest
 * breakpoint and two at the narrowest, so the offer always follows something
 * real. Eight thereafter keeps them from clustering.
 */
const FIRST_OFFER_AFTER = 4;
const OFFER_EVERY = 8;

/**
 * Interleaves offers into the product list.
 *
 * Offers past the end of the products are dropped rather than piled at the
 * bottom — three banners under a four-product category reads as a page with
 * nothing on it.
 */
function interleave(
  products: ProductListItem[],
  offers: ResolvedPlacement[],
): (
  | { kind: "product"; item: ProductListItem; index: number }
  | {
      kind: "offer";
      item: ResolvedPlacement;
    }
)[] {
  if (offers.length === 0) {
    return products.map((item, index) => ({
      kind: "product" as const,
      item,
      index,
    }));
  }

  const cells: ReturnType<typeof interleave> = [];
  let placed = 0;

  products.forEach((item, index) => {
    const due =
      index === FIRST_OFFER_AFTER ||
      (index > FIRST_OFFER_AFTER &&
        (index - FIRST_OFFER_AFTER) % OFFER_EVERY === 0);

    if (due && placed < offers.length) {
      cells.push({ kind: "offer", item: offers[placed] });
      placed++;
    }
    cells.push({ kind: "product", item, index });
  });

  return cells;
}

export function ProductGrid({
  products,
  savedIds,
  offers = [],
  className,
  emptyTitle = "Nothing here yet",
  emptyBody = "Try a different category, or widen the filters.",
}: {
  products: ProductListItem[];
  /** Which of these the signed-in user has saved. Empty for guests. */
  savedIds?: ReadonlySet<string>;
  /** Placements targeting the `in_grid` slot on this route. */
  offers?: ResolvedPlacement[];
  /** Overrides the column counts. Used by a store's layout preset. */
  className?: string;
  emptyTitle?: string;
  emptyBody?: string;
}) {
  if (products.length === 0) {
    // An empty screen is an invitation to act, not a shrug.
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border border-border border-dashed px-8 py-16 text-center">
        <div className="grid size-14 place-items-center rounded-full bg-surface-2">
          <PackageOpen className="size-6 text-tertiary-text" aria-hidden />
        </div>
        <div className="flex flex-col gap-1">
          <p className="font-medium">{emptyTitle}</p>
          <p className="max-w-sm text-secondary-text text-sm">{emptyBody}</p>
        </div>
        <Button variant="outline" render={<Link href="/search" />}>
          Browse everything
        </Button>
      </div>
    );
  }

  const cells = interleave(products, offers);

  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4",
        className,
      )}
    >
      {cells.map((cell) =>
        cell.kind === "product" ? (
          <ProductCard
            key={cell.item.id}
            product={cell.item}
            saved={savedIds?.has(cell.item.id) ?? false}
            // The first row is above the fold and holds the LCP image.
            priority={cell.index < 4}
            className="scroll-settle"
          />
        ) : (
          <GridOffer key={cell.item.id} placement={cell.item} />
        ),
      )}
    </div>
  );
}

/**
 * One offer occupying a grid cell.
 *
 * Spans two columns because an offer squeezed into a card-width column ends up
 * with a headline over three lines and nothing else. Two columns is one card's
 * height and reads at a glance.
 *
 * Centred vertically rather than stretched. The row is as tall as a product
 * card, and a banner pulled to that height would shout; sitting in the middle
 * of the band it reads as one item among the products, which is what it is.
 *
 * Attributed, like every other placement: a buyer seeing "free delivery" needs
 * to know whether the marketplace or one seller is promising it.
 */
function GridOffer({ placement }: { placement: ResolvedPlacement }) {
  return (
    <div className="col-span-2 flex flex-col justify-center gap-1.5">
      <p className="flex items-center gap-1.5 text-tertiary-text text-xs">
        {placement.scope === "platform" ? (
          <>
            <BadgeCheck aria-hidden className="size-3.5 text-accent-text" />
            <span>Marketplace offer</span>
          </>
        ) : (
          <>
            <Store aria-hidden className="size-3.5" />
            <span>
              Offer from{" "}
              <span className="text-secondary-text">
                {placement.storeName ?? "this store"}
              </span>
            </span>
          </>
        )}
      </p>
      <BlockRenderer
        blocks={[
          { id: placement.id, type: placement.type, data: placement.data },
        ]}
      />
    </div>
  );
}
