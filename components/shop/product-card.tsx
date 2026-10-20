import Link from "next/link";
import { PointerSurface } from "@/components/motion/pointer-surface";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ProductCardData = {
  slug: string;
  title: string;
  storeName: string;
  priceCents: number;
  compareAtCents?: number;
  currency: string;
  /** Stand-in until image upload lands; a CSS gradient keyed to the product. */
  tone: string;
  stock: number;
};

function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    // Integer minor units in, formatted string out. Never floating point maths.
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * The storefront's most repeated surface, so it sets the tone for everything.
 *
 * Separation comes from elevation and a surface tint rather than a hard
 * border — a grid of outlined rectangles is exactly the "identical rounded
 * cards" tell AGENTS.md warns about.
 *
 * The image well has a fixed aspect-ratio so nothing shifts when the real
 * image lands, and the inner layer is scaled past its box so the parallax
 * drift never exposes an edge.
 */
export function ProductCard({
  product,
  className,
}: {
  product: ProductCardData;
  className?: string;
}) {
  const {
    slug,
    title,
    storeName,
    priceCents,
    compareAtCents,
    currency,
    tone,
    stock,
  } = product;

  const onSale = compareAtCents !== undefined && compareAtCents > priceCents;
  const lowStock = stock > 0 && stock <= 5;

  return (
    <PointerSurface className={cn("group rounded-xl", className)}>
      <Link
        href={`/p/${slug}`}
        // Prefetch on hover and on pointerdown for touch, so the tap has
        // already started fetching before the navigation commits.
        prefetch
        className={cn(
          "flex h-full flex-col gap-3 rounded-xl bg-surface-1 p-3",
          "shadow-e1 outline-none transition-transform duration-[--duration-fast] ease-[--ease-out]",
          "active:scale-[0.985]",
          "focus-visible:ring-3 focus-visible:ring-ring/40",
        )}
      >
        <div
          className="parallax relative aspect-[4/5] overflow-hidden rounded-lg bg-surface-sunken"
          // Stand-in for the blur placeholder that ships with real uploads.
          style={{ background: tone }}
        >
          {/* Scaled and drifted by the .parallax keyframes on scroll. */}
          <div className="absolute inset-0" style={{ background: tone }} />

          {(onSale || lowStock || stock === 0) && (
            <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
              {stock === 0 ? (
                <Badge variant="neutral">Sold out</Badge>
              ) : onSale ? (
                <Badge variant="default">Sale</Badge>
              ) : null}
              {lowStock && stock > 0 ? (
                <Badge variant="critical">Only {stock} left</Badge>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-1">
          <p className="text-tertiary-text text-xs">{storeName}</p>
          <h3 className="line-clamp-2 font-medium text-sm leading-snug">
            {title}
          </h3>

          <div className="mt-auto flex items-baseline gap-2 pt-1.5">
            <span className="tabular font-semibold text-[0.9375rem]">
              {formatPrice(priceCents, currency)}
            </span>
            {onSale ? (
              <span className="tabular text-tertiary-text text-xs line-through">
                {formatPrice(compareAtCents, currency)}
              </span>
            ) : null}
          </div>
        </div>
      </Link>
    </PointerSurface>
  );
}
