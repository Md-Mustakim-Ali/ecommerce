import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { requireStorePermission } from "@/lib/auth/access";
import {
  getProductForEditing,
  listAvailableAttributes,
} from "@/lib/catalog/product-editor";
import { ProductEditor } from "./product-editor";

export async function generateMetadata({
  params,
}: PageProps<"/dashboard/[storeId]/products/[productId]">): Promise<Metadata> {
  const { storeId, productId } = await params;
  const product = await getProductForEditing(productId, storeId);
  return { title: product ? product.title : "Product" };
}

/**
 * The product editor.
 *
 * Opening it needs `product.update`; the variant matrix inside is gated on
 * `variant.manage` and publishing on `product.publish`, so a catalog role that
 * can write copy but not change prices gets the parts it is allowed to use
 * rather than a page it cannot open.
 */
export default async function EditProductPage({
  params,
}: PageProps<"/dashboard/[storeId]/products/[productId]">) {
  const { storeId, productId } = await params;
  const access = await requireStorePermission(storeId, "product.update");

  const [product, available] = await Promise.all([
    getProductForEditing(productId, storeId),
    listAvailableAttributes(),
  ]);
  if (!product) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="truncate font-semibold text-xl tracking-tight">
            {product.title}
          </h1>
          <p className="flex flex-wrap items-center gap-2 text-secondary-text text-sm">
            <Badge
              variant={
                product.status === "active"
                  ? "positive"
                  : product.status === "archived"
                    ? "critical"
                    : "neutral"
              }
            >
              {product.status === "active"
                ? "Live"
                : product.status === "archived"
                  ? "Archived"
                  : "Draft"}
            </Badge>
            {product.status === "active" ? (
              <Link
                href={`/p/${product.slug}`}
                className="underline underline-offset-4 hover:text-primary-text"
              >
                View on the storefront
              </Link>
            ) : (
              <span className="text-tertiary-text">
                Not visible to shoppers yet
              </span>
            )}
          </p>
        </div>
        <Link
          href={`/dashboard/${storeId}/products`}
          className="text-secondary-text text-sm hover:underline"
        >
          All products
        </Link>
      </div>

      <ProductEditor
        storeId={storeId}
        product={{
          id: product.id,
          title: product.title,
          description: product.description,
          status: product.status,
          stockDisplay: product.stockDisplay,
          lowStockThreshold: product.lowStockThreshold,
          attributes: product.attributes,
          variants: product.variants,
          images: product.images,
        }}
        available={available}
        permissions={{
          manageVariants: access.permissions.has("variant.manage"),
          publish: access.permissions.has("product.publish"),
          archive: access.permissions.has("product.archive"),
          proposeAttribute: access.permissions.has("attribute.propose"),
          delete: access.permissions.has("product.delete"),
        }}
      />
    </div>
  );
}
