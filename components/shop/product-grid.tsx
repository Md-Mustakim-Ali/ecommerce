import { PackageOpen } from "lucide-react";
import Link from "next/link";
import { ProductCard } from "@/components/shop/product-card";
import { Button } from "@/components/ui/button";
import type { ProductListItem } from "@/lib/catalog/queries";

export function ProductGrid({
  products,
  emptyTitle = "Nothing here yet",
  emptyBody = "Try a different category, or widen the filters.",
}: {
  products: ProductListItem[];
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

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
      {products.map((product, index) => (
        <ProductCard
          key={product.id}
          product={product}
          // The first row is above the fold and holds the LCP image.
          priority={index < 4}
          className="scroll-settle"
        />
      ))}
    </div>
  );
}
