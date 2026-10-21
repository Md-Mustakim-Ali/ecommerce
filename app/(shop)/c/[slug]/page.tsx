import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FilterBar } from "@/components/shop/filter-bar";
import { Pagination } from "@/components/shop/pagination";
import { ProductGrid } from "@/components/shop/product-grid";
import { ProductGridSkeleton } from "@/components/ui/skeleton";
import { getSession } from "@/lib/auth/guards";
import {
  getBrandFacets,
  getCategoryBySlug,
  getSavedProductIds,
  listProducts,
} from "@/lib/catalog/queries";
import { parseProductFilters } from "@/lib/catalog/search-params";

export async function generateMetadata({
  params,
}: PageProps<"/c/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  return { title: category?.name ?? "Category" };
}

async function Results({
  slug,
  raw,
}: {
  slug: string;
  raw: Record<string, string | string[] | undefined>;
}) {
  const filters = parseProductFilters(raw, { categorySlug: slug });
  const [result, brandFacets] = await Promise.all([
    listProducts(filters),
    getBrandFacets(slug),
  ]);

  const session = await getSession();
  const savedIds = await getSavedProductIds(
    session?.user.id ?? null,
    result.items.map((p) => p.id),
  );

  return (
    <>
      <FilterBar
        brands={brandFacets}
        total={result.total}
        hasQuery={Boolean(filters.q)}
      />
      <ProductGrid products={result.items} savedIds={savedIds} />
      <Pagination
        page={result.page}
        perPage={result.perPage}
        total={result.total}
        searchParams={raw}
        basePath={`/c/${slug}`}
      />
    </>
  );
}

export default async function CategoryPage({
  params,
  searchParams,
}: PageProps<"/c/[slug]">) {
  const [{ slug }, raw] = await Promise.all([params, searchParams]);

  const category = await getCategoryBySlug(slug);
  if (!category) notFound();

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <nav aria-label="Breadcrumb" className="text-secondary-text text-sm">
        <Link href="/" className="hover:text-primary-text">
          Home
        </Link>
        <span className="px-2 text-tertiary-text">/</span>
        <span className="text-primary-text">{category.name}</span>
      </nav>

      <h1 className="font-semibold text-2xl tracking-tight sm:text-3xl">
        {category.name}
      </h1>

      <Suspense
        key={JSON.stringify(raw)}
        fallback={
          <div className="flex flex-col gap-6">
            <div className="h-9" />
            <ProductGridSkeleton count={8} />
          </div>
        }
      >
        <Results slug={slug} raw={raw} />
      </Suspense>
    </div>
  );
}
