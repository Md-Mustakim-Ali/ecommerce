import Image from "next/image";
import Link from "next/link";
import { PointerSurface } from "@/components/motion/pointer-surface";
import { Badge } from "@/components/ui/badge";
import type { ProductListItem } from "@/lib/catalog/queries";
import { formatMoney } from "@/lib/money/format";
import { cn } from "@/lib/utils";

/**
 * The storefront's most repeated surface, so it sets the tone for everything.
 *
 * Separation comes from elevation and surface tint rather than a hard border —
 * a grid of outlined rectangles is exactly the "identical rounded cards" tell
 * AGENTS.md warns about.
 *
 * The image well has a fixed aspect-ratio and a blur placeholder, so nothing
 * moves when the real image lands. The inner layer is scaled past its box so
 * the scroll parallax never exposes an edge.
 */
export function ProductCard({
  product,
  priority,
  className,
}: {
  product: ProductListItem;
  /** Set on the first row so the LCP image is not lazy-loaded. */
  priority?: boolean;
  className?: string;
}) {
  const onSale =
    product.compareAtCents !== null &&
    product.compareAtCents > product.priceCents;
  const soldOut = product.stock <= 0;
  const lowStock = !soldOut && product.stock <= 5;

  return (
    <PointerSurface className={cn("group rounded-xl", className)}>
      <Link
        href={`/p/${product.slug}`}
        prefetch
        className={cn(
          "flex h-full flex-col gap-3 rounded-xl bg-surface-1 p-3",
          "shadow-e1 outline-none transition-transform duration-[--duration-fast] ease-[--ease-out]",
          "active:scale-[0.985] focus-visible:ring-3 focus-visible:ring-ring/40",
        )}
      >
        <div className="parallax relative aspect-[4/5] overflow-hidden rounded-lg bg-surface-sunken">
          {product.imageUrl ? (
            <Image
              src={product.imageUrl}
              alt={product.title}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              priority={priority}
              placeholder={product.blurDataUrl ? "blur" : "empty"}
              blurDataURL={product.blurDataUrl ?? undefined}
              className="object-cover"
            />
          ) : (
            <div className="absolute inset-0 bg-surface-2" />
          )}

          {soldOut || onSale || lowStock ? (
            <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
              {soldOut ? (
                <Badge variant="neutral">Sold out</Badge>
              ) : onSale ? (
                <Badge variant="default">Sale</Badge>
              ) : null}
              {lowStock ? (
                <Badge variant="critical">Only {product.stock} left</Badge>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex flex-1 flex-col gap-1">
          <p className="truncate text-tertiary-text text-xs">
            {product.brandName ?? product.storeName}
          </p>
          <h3 className="line-clamp-2 font-medium text-sm leading-snug">
            {product.title}
          </h3>

          <div className="mt-auto flex items-baseline gap-2 pt-1.5">
            <span className="tabular font-semibold text-[0.9375rem]">
              {formatMoney(product.priceCents, "USD")}
            </span>
            {onSale && product.compareAtCents !== null ? (
              <span className="tabular text-tertiary-text text-xs line-through">
                {formatMoney(product.compareAtCents, "USD")}
              </span>
            ) : null}
          </div>
        </div>
      </Link>
    </PointerSurface>
  );
}
