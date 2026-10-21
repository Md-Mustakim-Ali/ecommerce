import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductDetail } from "@/components/shop/product-detail";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getProductBySlug } from "@/lib/catalog/queries";

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

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-6 sm:px-6 sm:py-10">
      <nav aria-label="Breadcrumb" className="text-secondary-text text-sm">
        <Link href="/" className="hover:text-primary-text">
          Home
        </Link>
        <span className="px-2 text-tertiary-text">/</span>
        <Link
          href={`/c/${product.categorySlug}`}
          className="hover:text-primary-text"
        >
          {product.categoryName}
        </Link>
      </nav>

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
        <p className="text-secondary-text text-sm">
          Sold by <span className="text-primary-text">{product.storeName}</span>
        </p>
      </div>

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
      />

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
    </div>
  );
}
