import Image from "next/image";
import Link from "next/link";
import { PointerSurface } from "@/components/motion/pointer-surface";
import { QuickAdd } from "@/components/shop/quick-add";
import { QuickView } from "@/components/shop/quick-view";
import { RatingStars } from "@/components/shop/rating-stars";
import { SaveButton } from "@/components/shop/save-button";
import { Badge } from "@/components/ui/badge";
import type { ProductListItem } from "@/lib/catalog/queries";
import { cardStockMessage } from "@/lib/catalog/stock";
import { formatMoney } from "@/lib/money/format";
import { cn } from "@/lib/utils";

/**
 * The storefront's most repeated surface, so it sets the tone for everything.
 *
 * A square image rather than 4:5. Portrait imagery made the card tall enough
 * that the information underneath read as an afterthought, and a grid of them
 * scrolled forever. Square keeps the photo dominant without swallowing the row.
 *
 * Actions live on the card, not only on the product page: save, quick view and
 * quick add. On a marketplace grid, making someone open a product just to see
 * the other photos or add a single-variant item is friction with no upside.
 *
 * Separation comes from elevation and surface tint rather than a hard border —
 * a grid of outlined rectangles is exactly the "identical rounded cards" tell
 * AGENTS.md warns about.
 */
export function ProductCard({
  product,
  saved = false,
  priority,
  className,
}: {
  product: ProductListItem;
  saved?: boolean;
  /** Set on the first row so the LCP image is not lazy-loaded. */
  priority?: boolean;
  className?: string;
}) {
  const onSale =
    product.compareAtCents !== null &&
    product.compareAtCents > product.priceCents;
  const soldOut = product.stock <= 0;
  // Uses the shared rule so a card cannot quote a summed total as though it
  // were a buyable quantity.
  const stock = cardStockMessage({
    totalQuantity: product.stock,
    display: product.stockDisplay,
    lowStockThreshold: product.lowStockThreshold,
  });
  const lowStock = stock.kind === "low";
  const discount = onSale
    ? Math.round((1 - product.priceCents / (product.compareAtCents ?? 1)) * 100)
    : 0;
  // Combinations can be priced differently, so a single number would be a
  // guess. Show the span the shopper will actually choose within.
  const hasRange = product.maxPriceCents > product.priceCents;

  return (
    <PointerSurface className={cn("group rounded-xl", className)}>
      <div className="flex h-full flex-col gap-3 rounded-xl bg-surface-1 p-3 shadow-e1">
        <div className="relative">
          <Link
            href={`/p/${product.slug}`}
            prefetch
            className={cn(
              "block overflow-hidden rounded-lg outline-none",
              "focus-visible:ring-3 focus-visible:ring-ring/40",
            )}
          >
            <div className="parallax relative aspect-square overflow-hidden rounded-lg bg-surface-sunken">
              {product.imageUrl ? (
                <Image
                  src={product.imageUrl}
                  alt={product.title}
                  fill
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                  priority={priority}
                  placeholder={product.blurDataUrl ? "blur" : "empty"}
                  blurDataURL={product.blurDataUrl ?? undefined}
                  className={cn(
                    "object-cover transition-transform duration-[--duration-slow] ease-[--ease-out]",
                    soldOut && "opacity-60",
                  )}
                />
              ) : (
                <div className="absolute inset-0 bg-surface-2" />
              )}
            </div>
          </Link>

          {/* Status, top-left. */}
          {soldOut || onSale || lowStock ? (
            <div className="pointer-events-none absolute top-2 left-2 flex flex-col items-start gap-1">
              {soldOut ? (
                <Badge variant="neutral">Sold out</Badge>
              ) : onSale ? (
                <Badge variant="default">-{discount}%</Badge>
              ) : null}
              {lowStock ? <Badge variant="critical">{stock.text}</Badge> : null}
            </div>
          ) : null}

          {/*
            Actions, top-right. Always visible on touch — a hover-only control
            is unreachable on a phone, which is where most of this traffic is.
            They fade in on pointer devices to keep the grid calm.
          */}
          <div
            className={cn(
              "absolute top-2 right-2 flex flex-col gap-1.5",
              "transition-opacity duration-[--duration-fast]",
              "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100",
            )}
          >
            <SaveButton productId={product.id} initialSaved={saved} />
            <QuickView slug={product.slug} />
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-tertiary-text text-xs">
              {product.brandName ?? product.storeName}
            </p>
            <RatingStars
              average={product.ratingAverage}
              count={product.ratingCount}
            />
          </div>

          <Link
            href={`/p/${product.slug}`}
            prefetch
            className="line-clamp-2 font-medium text-sm leading-snug outline-none hover:underline focus-visible:underline"
          >
            {product.title}
          </Link>

          <div className="mt-auto flex items-end justify-between gap-2 pt-2">
            {/*
              The original range is struck through above the current one. With
              per-combination pricing there is no single "was" price, so
              crossing out one number would misstate the discount.
            */}
            <div className="flex flex-col gap-0.5">
              {onSale && product.compareAtCents !== null ? (
                <span className="tabular text-tertiary-text text-xs line-through">
                  {formatMoney(product.compareAtCents, "USD")}
                  {product.compareAtMaxCents !== null &&
                  product.compareAtMaxCents > product.compareAtCents
                    ? ` – ${formatMoney(product.compareAtMaxCents, "USD")}`
                    : ""}
                </span>
              ) : null}
              <span className="tabular font-semibold text-base leading-none">
                {formatMoney(product.priceCents, "USD")}
                {hasRange ? (
                  <span className="font-normal text-tertiary-text">
                    {" – "}
                    {formatMoney(product.maxPriceCents, "USD")}
                  </span>
                ) : null}
              </span>
            </div>

            <QuickAdd
              variantId={product.defaultVariantId}
              variantCount={product.variantCount}
              productSlug={product.slug}
              soldOut={soldOut}
            />
          </div>
        </div>
      </div>
    </PointerSurface>
  );
}
