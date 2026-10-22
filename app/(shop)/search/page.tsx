import type { Metadata } from "next";
import { Suspense } from "react";
import { FilterPanel } from "@/components/shop/filter-panel";
import { Pagination } from "@/components/shop/pagination";
import { ProductGrid } from "@/components/shop/product-grid";
import { ProductGridSkeleton } from "@/components/ui/skeleton";
import { getSession } from "@/lib/auth/guards";
import {
  getAllFacets,
  getSavedProductIds,
  listProducts,
} from "@/lib/catalog/queries";
import { parseProductFilters } from "@/lib/catalog/search-params";
import { getGridOffers } from "@/lib/content/queries";

export const metadata: Metadata = { title: "Search" };

async function Results({
  raw,
}: {
  raw: Record<string, string | string[] | undefined>;
}) {
  const filters = parseProductFilters(raw);
  const [result, facets, offers] = await Promise.all([
    listProducts(filters),
    getAllFacets(),
    getGridOffers({ kind: "search" }),
  ]);

  const session = await getSession();
  const savedIds = await getSavedProductIds(
    session?.user.id ?? null,
    result.items.map((p) => p.id),
  );

  return (
    <>
      <FilterPanel
        facets={facets}
        total={result.total}
        hasQuery={Boolean(filters.q)}
      />
      <ProductGrid
        products={result.items}
        savedIds={savedIds}
        offers={offers}
        emptyTitle={
          filters.q ? `Nothing matches "${filters.q}"` : "No products yet"
        }
        emptyBody={
          filters.q
            ? "Try fewer words, or check the spelling. Filters may also be narrowing this down."
            : "Widen the filters, or browse a category."
        }
      />
      <Pagination
        page={result.page}
        perPage={result.perPage}
        total={result.total}
        searchParams={raw}
        basePath="/search"
      />
    </>
  );
}

export default async function SearchPage({
  searchParams,
}: PageProps<"/search">) {
  const raw = await searchParams;
  const q = typeof raw.q === "string" ? raw.q : "";

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="font-semibold text-2xl tracking-tight">
        {q ? `Results for "${q}"` : "All products"}
      </h1>

      {/*
        Keyed on the serialised params so changing a filter remounts the
        boundary and shows the skeleton, rather than leaving stale results on
        screen while the new ones load.
      */}
      <Suspense
        key={JSON.stringify(raw)}
        fallback={
          <div className="flex flex-col gap-6">
            <div className="h-9" />
            <ProductGridSkeleton count={8} />
          </div>
        }
      >
        <Results raw={raw} />
      </Suspense>
    </div>
  );
}
