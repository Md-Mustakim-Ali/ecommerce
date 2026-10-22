import { eq } from "drizzle-orm";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireStorePermission } from "@/lib/auth/access";
import { listProductsForStore } from "@/lib/catalog/product-editor";
import { db } from "@/lib/db";
import { stores } from "@/lib/db/schema";
import { formatMoney } from "@/lib/money/format";

export const metadata: Metadata = { title: "Products" };

const STATUS_BADGE = {
  active: { label: "Live", variant: "positive" as const },
  draft: { label: "Draft", variant: "neutral" as const },
  archived: { label: "Archived", variant: "critical" as const },
};

/**
 * The seller's listings.
 *
 * This is where a saved draft goes. Without it, creating a product wrote a row
 * to the database and returned the seller to a page showing a count — the
 * listing existed and there was nowhere to see it, which reads as the save
 * having failed.
 */
export default async function StoreProductsPage({
  params,
  searchParams,
}: PageProps<"/dashboard/[storeId]/products">) {
  const { storeId } = await params;
  const query = await searchParams;

  const access = await requireStorePermission(storeId, "product.view");

  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
    columns: { name: true },
  });
  if (!store) notFound();

  const rawStatus = Array.isArray(query.status)
    ? query.status[0]
    : query.status;
  const filter =
    rawStatus === "active" || rawStatus === "draft" || rawStatus === "archived"
      ? rawStatus
      : undefined;

  const all = await listProductsForStore(storeId);
  const rows = filter ? all.filter((row) => row.status === filter) : all;

  const counts = {
    all: all.length,
    active: all.filter((r) => r.status === "active").length,
    draft: all.filter((r) => r.status === "draft").length,
    archived: all.filter((r) => r.status === "archived").length,
  };

  const canCreate = access.permissions.has("product.create");
  const canEdit = access.permissions.has("product.update");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-semibold text-xl tracking-tight">Products</h1>
          <p className="text-secondary-text text-sm">
            {store.name} · {counts.all}{" "}
            {counts.all === 1 ? "listing" : "listings"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/dashboard/${storeId}`}
            className="text-secondary-text text-sm hover:underline"
          >
            Back to store
          </Link>
          {canCreate ? (
            <Button
              size="sm"
              render={<Link href={`/dashboard/${storeId}/products/new`} />}
            >
              <Plus aria-hidden />
              New product
            </Button>
          ) : null}
        </div>
      </div>

      <nav className="flex flex-wrap gap-1 border-border border-b pb-2">
        {(
          [
            ["", "All", counts.all],
            ["active", "Live", counts.active],
            ["draft", "Drafts", counts.draft],
            ["archived", "Archived", counts.archived],
          ] as const
        ).map(([value, label, count]) => {
          const active = (filter ?? "") === value;
          return (
            <Link
              key={label}
              href={
                value
                  ? `/dashboard/${storeId}/products?status=${value}`
                  : `/dashboard/${storeId}/products`
              }
              aria-current={active ? "page" : undefined}
              className={`rounded-full px-3 py-1.5 font-medium text-sm ${
                active
                  ? "bg-surface-3 text-primary-text"
                  : "text-secondary-text hover:bg-surface-2"
              }`}
            >
              {label}
              <span className="ml-1.5 text-tertiary-text">{count}</span>
            </Link>
          );
        })}
      </nav>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-border border-dashed px-4 py-10 text-center">
          <p className="text-secondary-text text-sm">
            {filter ? "Nothing here." : "No products yet."}
          </p>
          {canCreate && !filter ? (
            <Button
              size="sm"
              variant="outline"
              render={<Link href={`/dashboard/${storeId}/products/new`} />}
            >
              Add your first product
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="flex flex-col gap-px overflow-hidden rounded-md bg-border">
          {rows.map((row) => {
            const badge = STATUS_BADGE[row.status];
            const priceRange =
              row.minPriceCents === row.maxPriceCents
                ? formatMoney(row.minPriceCents, "USD")
                : `${formatMoney(row.minPriceCents, "USD")} – ${formatMoney(row.maxPriceCents, "USD")}`;

            return (
              <li key={row.id}>
                <Link
                  href={
                    canEdit
                      ? `/dashboard/${storeId}/products/${row.id}`
                      : `/p/${row.slug}`
                  }
                  className="flex items-center gap-4 bg-surface-1 px-4 py-3 hover:bg-surface-2"
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
                    <span className="truncate font-medium text-sm">
                      {row.title}
                    </span>
                    <span className="truncate text-secondary-text text-xs">
                      {row.brandName ? `${row.brandName} · ` : ""}
                      {row.variantCount}{" "}
                      {row.variantCount === 1 ? "variant" : "variants"} ·{" "}
                      {row.stock} in stock
                    </span>
                  </div>

                  <span className="tabular hidden shrink-0 text-sm sm:block">
                    {priceRange}
                  </span>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
