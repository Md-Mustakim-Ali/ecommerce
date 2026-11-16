import { asc, isNotNull } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { EditorMedia } from "@/components/editor/media-context";
import { Badge } from "@/components/ui/badge";
import { requireStorePermission } from "@/lib/auth/access";
import {
  getProductForEditing,
  listAvailableAttributes,
} from "@/lib/catalog/product-editor";
import { db } from "@/lib/db";
import { categories } from "@/lib/db/schema";
import { sweepStoreMediaAfterResponse } from "@/lib/media/opportunistic";
import { parseDescriptionDoc } from "@/lib/rich-text/schema";
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

  // This is the page a seller sits on while a video transcodes, so it is the
  // one where waiting an hour for the scheduled sweep is most obviously wrong.
  // Runs after the response, so it costs the render nothing.
  sweepStoreMediaAfterResponse(storeId);

  const [product, available, categoryOptions] = await Promise.all([
    getProductForEditing(productId, storeId),
    listAvailableAttributes(),
    // Leaves only, matching the create form: a product belongs to
    // "Headphones", not to "Electronics".
    db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(isNotNull(categories.parentId))
      .orderBy(asc(categories.name)),
  ]);
  if (!product) notFound();

  // Re-validated rather than trusted. The column holds whatever passed the
  // schema when it was written, and handing the editor a shape it cannot
  // represent would silently discard the seller's copy on their next save.
  const parsed = product.descriptionDoc
    ? parseDescriptionDoc(product.descriptionDoc)
    : null;
  const parsedDescription = parsed?.ok ? parsed.doc : null;

  const mediaById = new Map<string, EditorMedia>(
    product.media.map((asset) => [asset.id, asset]),
  );

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
        media={mediaById}
        product={{
          id: product.id,
          title: product.title,
          description: product.description,
          descriptionDoc: parsedDescription,
          status: product.status,
          publishMode: product.publishMode,
          stockDisplay: product.stockDisplay,
          lowStockThreshold: product.lowStockThreshold,
          attributes: product.attributes,
          variants: product.variants,
          media: product.media,
          categoryId: product.categoryId,
          brandId: product.brandId,
          brandName: product.brandName,
          brandSlug: product.brandSlug,
          brandStatus: product.brandStatus,
          brandMergedIntoId: product.brandMergedIntoId,
          tags: product.tags,
        }}
        categories={categoryOptions}
        available={available}
        permissions={{
          manageVariants: access.permissions.has("variant.manage"),
          publish: access.permissions.has("product.publish"),
          archive: access.permissions.has("product.archive"),
          proposeAttribute: access.permissions.has("attribute.propose"),
          delete: access.permissions.has("product.delete"),
          proposeBrand: access.permissions.has("brand.propose"),
          proposeTag: access.permissions.has("tag.propose"),
        }}
      />
    </div>
  );
}
