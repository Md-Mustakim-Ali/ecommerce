import { cn } from "@/lib/utils";

/**
 * A shimmer sweep, not a pulsing grey block.
 *
 * The sweep is a translated gradient on a pseudo-element, so it animates on
 * the compositor. A pulsing opacity on the block itself is both cheaper-looking
 * and, at scale, a repaint per element per frame.
 *
 * Skeletons only work if they are the same shape as the thing they replace.
 * Use the composed skeletons below rather than assembling loose bars, or the
 * layout shifts the moment real content arrives — the one thing AGENTS.md
 * calls the deadest thing a page can do.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("shimmer rounded-sm bg-surface-sunken", className)}
      {...props}
    />
  );
}

/**
 * Mirrors ProductCard exactly: same padding, same 4/5 image ratio, same three
 * text rows at the same sizes. Swapping one for the other must not move a
 * single pixel.
 */
function ProductCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-full flex-col gap-3 rounded-xl bg-surface-1 p-3 shadow-e1",
        className,
      )}
      aria-hidden
    >
      <Skeleton className="aspect-[4/5] w-full rounded-lg" />
      <div className="flex flex-1 flex-col gap-1">
        {/* store name — text-xs */}
        <Skeleton className="h-3 w-20 rounded-full" />
        {/* title — two lines of text-sm */}
        <Skeleton className="mt-1 h-3.5 w-full rounded-full" />
        <Skeleton className="h-3.5 w-2/3 rounded-full" />
        {/* price row */}
        <Skeleton className="mt-auto h-4 w-16 rounded-full" />
      </div>
    </div>
  );
}

/** A full grid of them, matching the storefront's responsive columns. */
function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <output
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
      aria-label="Loading products"
    >
      {Array.from({ length: count }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder list
        <ProductCardSkeleton key={i} />
      ))}
    </output>
  );
}

/** Matches the product detail page: gallery beside the buy column. */
function ProductDetailSkeleton() {
  return (
    <output className="grid gap-8 lg:grid-cols-2" aria-label="Loading product">
      <Skeleton className="aspect-[4/5] w-full rounded-xl" />
      <div className="flex flex-col gap-4">
        <Skeleton className="h-3 w-24 rounded-full" />
        <Skeleton className="h-7 w-4/5 rounded-full" />
        <Skeleton className="h-6 w-28 rounded-full" />
        <div className="mt-2 flex gap-2">
          <Skeleton className="h-11 w-16 rounded-control" />
          <Skeleton className="h-11 w-16 rounded-control" />
          <Skeleton className="h-11 w-16 rounded-control" />
        </div>
        <Skeleton className="mt-2 h-13 w-full rounded-control" />
        <div className="mt-4 flex flex-col gap-2">
          <Skeleton className="h-3.5 w-full rounded-full" />
          <Skeleton className="h-3.5 w-full rounded-full" />
          <Skeleton className="h-3.5 w-3/4 rounded-full" />
        </div>
      </div>
    </output>
  );
}

/** Dense table rows for the seller dashboard and admin. */
function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <output
      className="flex flex-col gap-px overflow-hidden rounded-md bg-border"
      aria-label="Loading"
    >
      {Array.from({ length: rows }, (_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder list
          key={i}
          className="flex items-center gap-4 bg-surface-1 px-4 py-3"
        >
          <Skeleton className="size-9 shrink-0 rounded-md" />
          <Skeleton className="h-3.5 flex-1 rounded-full" />
          <Skeleton className="h-3.5 w-20 rounded-full" />
          <Skeleton className="h-3.5 w-14 rounded-full" />
        </div>
      ))}
    </output>
  );
}

export {
  Skeleton,
  ProductCardSkeleton,
  ProductGridSkeleton,
  ProductDetailSkeleton,
  TableSkeleton,
};
