import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PlacementSlot } from "@/components/content/placement-slot";
import { ProductDetail } from "@/components/shop/product-detail";
import { RatingStars } from "@/components/shop/rating-stars";
import { ReviewSection } from "@/components/shop/review-section";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getSession } from "@/lib/auth/guards";
import { getCategoryAncestry, getProductBySlug } from "@/lib/catalog/queries";
import {
  listReviewablePurchases,
  listReviewsForProduct,
  ratingBreakdown,
} from "@/lib/reviews/queries";

export async function generateMetadata({
  params,
}: PageProps<"/p/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: "Not found" };
  return {
    title: product.title,
    description: product.description ?? undefined,
  };
}

export default async function ProductPage({ params }: PageProps<"/p/[slug]">) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  const session = await getSession();

  const [ancestry, reviews, breakdown, reviewable] = await Promise.all([
    // Full path, so a placement targeting a parent category reaches this page.
    getCategoryAncestry(product.categorySlug),
    listReviewsForProduct(product.id),
    ratingBreakdown(product.id),
    // Scoped to this product, so the form only appears for someone who has
    // actually had this delivered.
    session
      ? listReviewablePurchases(session.user.id, product.id)
      : Promise.resolve([]),
  ]);

  const routeContext = {
    kind: "product" as const,
    slug,
    storeSlug: product.storeSlug,
    categoryPath: ancestry,
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8">
      {/*
        The breadcrumb ends on the product itself. Stopping at the category
        leaves the trail one step short of where the visitor actually is, and
        the current page is the one crumb that never needs to be a link.
      */}
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center text-secondary-text text-sm">
          <li>
            <Link href="/" className="hover:text-primary-text">
              Home
            </Link>
          </li>
          <li aria-hidden className="px-2 text-tertiary-text">
            /
          </li>
          <li>
            <Link
              href={`/c/${product.categorySlug}`}
              className="hover:text-primary-text"
            >
              {product.categoryName}
            </Link>
          </li>
          <li aria-hidden className="px-2 text-tertiary-text">
            /
          </li>
          <li className="min-w-0">
            <span
              aria-current="page"
              className="line-clamp-1 text-primary-text"
            >
              {product.title}
            </span>
          </li>
        </ol>
      </nav>

      {/* Above the title, so a marketplace-wide or store offer is the first
          thing read rather than something found halfway down. */}
      <PlacementSlot route={routeContext} slot="product_top" />

      <div className="flex flex-col gap-2">
        {product.brandName ? (
          <Link
            href={`/search?brand=${product.brandSlug}`}
            className="w-fit text-accent-text text-sm underline-offset-4 hover:underline"
          >
            {product.brandName}
          </Link>
        ) : null}
        <h1 className="font-semibold text-2xl leading-tight tracking-tight sm:text-3xl">
          {product.title}
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-secondary-text text-sm">
            Sold by{" "}
            <Link
              href={`/store/${product.storeSlug}`}
              className="text-primary-text underline-offset-4 hover:underline"
            >
              {product.storeName}
            </Link>
          </p>
          {breakdown.total > 0 ? (
            // Jumps to the section rather than repeating it. A rating in the
            // header that cannot be acted on is a dead end.
            <a
              href="#reviews"
              className="flex items-center gap-1.5 text-sm underline-offset-4 hover:underline"
            >
              <RatingStars
                average={breakdown.average}
                count={breakdown.total}
              />
              <span className="text-secondary-text">
                {breakdown.total} {breakdown.total === 1 ? "review" : "reviews"}
              </span>
            </a>
          ) : null}
        </div>
      </div>

      <PlacementSlot route={routeContext} slot="above_content" />

      <ProductDetail
        title={product.title}
        stockDisplay={product.stockDisplay}
        lowStockThreshold={product.lowStockThreshold}
        images={product.images.map((image) => ({
          id: image.id,
          url: image.url,
          alt: image.alt,
          blurDataUrl: image.blurDataUrl,
          tags: image.tags,
        }))}
        attributes={product.attributes.map((attribute) => ({
          id: attribute.id,
          slug: attribute.slug,
          name: attribute.name,
          kind: attribute.kind,
          unit: attribute.unit,
          role: attribute.role,
          values: attribute.values,
        }))}
        variants={product.variants.map((variant) => ({
          id: variant.id,
          sku: variant.sku,
          priceCents: variant.priceCents,
          compareAtPriceCents: variant.compareAtPriceCents,
          stock: variant.stock,
          combination: variant.combination,
        }))}
        beforePrice={
          <PlacementSlot route={routeContext} slot="product_before_price" />
        }
        afterOptions={
          <PlacementSlot route={routeContext} slot="product_after_options" />
        }
        sidebar={<PlacementSlot route={routeContext} slot="product_sidebar" />}
      />

      <PlacementSlot route={routeContext} slot="product_below_details" />

      <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
        <div className="flex flex-col gap-6">
          {product.description ? (
            <>
              <Separator />
              <div className="flex flex-col gap-2">
                <h2 className="font-medium text-sm">Details</h2>
                <p className="whitespace-pre-line text-secondary-text text-sm leading-relaxed">
                  {product.description}
                </p>
              </div>
            </>
          ) : null}

          {product.tags.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {product.tags.map((tag) => (
                <li key={tag.slug}>
                  <Link href={`/search?tag=${tag.slug}`}>
                    <Badge variant="outline">{tag.name}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      <Separator />

      <ReviewSection
        reviews={reviews}
        breakdown={breakdown}
        reviewable={reviewable}
      />
    </div>
  );
}
