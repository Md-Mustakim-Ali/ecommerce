import { desc, eq } from "drizzle-orm";
import { Heart } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ProductGrid } from "@/components/shop/product-grid";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/guards";
import { listProducts } from "@/lib/catalog/queries";
import { db } from "@/lib/db";
import { savedItems } from "@/lib/db/schema";

export const metadata: Metadata = { title: "Saved" };

/**
 * The buyer's saved items.
 *
 * The save button has been writing rows since the catalog work with nowhere to
 * read them — a heart that fills in and then leads nowhere is worse than no
 * heart at all.
 *
 * Products are fetched through listProducts rather than joined directly, so a
 * saved item whose store has since been suspended, or whose listing was
 * unpublished, drops out here exactly as it does everywhere else.
 */
export default async function SavedPage() {
  const user = await requireUser();

  const rows = await db
    .select({ productId: savedItems.productId })
    .from(savedItems)
    .where(eq(savedItems.userId, user.id))
    .orderBy(desc(savedItems.createdAt))
    .limit(100);

  const ids = rows.map((row) => row.productId);
  const listing = ids.length
    ? await listProducts({ productIds: ids, perPage: 100 })
    : { items: [], total: 0, page: 1, perPage: 100 };

  // Saved order, not catalogue order: most recently saved first is what
  // somebody returning to this page expects.
  const position = new Map(ids.map((id, index) => [id, index]));
  const items = [...listing.items].sort(
    (a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0),
  );

  const unavailable = ids.length - items.length;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-semibold text-2xl tracking-tight">Saved</h1>
          <p className="text-secondary-text text-sm">
            {items.length} {items.length === 1 ? "item" : "items"}
            {unavailable > 0 ? ` · ${unavailable} no longer available` : ""}
          </p>
        </div>
        <Link
          href="/account"
          className="text-secondary-text text-sm hover:underline"
        >
          Account
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-border border-dashed px-8 py-16 text-center">
          <div className="grid size-14 place-items-center rounded-full bg-surface-2">
            <Heart className="size-6 text-tertiary-text" aria-hidden />
          </div>
          <div className="flex flex-col gap-1">
            <p className="font-medium">Nothing saved yet</p>
            <p className="text-secondary-text text-sm">
              Tap the heart on anything you want to come back to.
            </p>
          </div>
          <Button render={<Link href="/search" />} variant="outline">
            Browse products
          </Button>
        </div>
      ) : (
        <ProductGrid products={items} savedIds={new Set(ids)} />
      )}
    </div>
  );
}
