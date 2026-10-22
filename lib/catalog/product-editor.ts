import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  attributes,
  attributeValues,
  brands,
  productAttributes,
  productAttributeValues,
  productImageAttributeValues,
  productImages,
  products,
  productTags,
  productVariants,
  tags,
  variantAttributeValues,
} from "@/lib/db/schema";

/**
 * Reads for the seller's product editor.
 *
 * The storefront reads a product to display it; this reads one to change it,
 * which is a different shape. Everything the editor can edit has to come back
 * even when it is empty, because a form cannot render a field for a value it
 * was never told about.
 */

export type EditorVariant = {
  id: string;
  sku: string | null;
  priceCents: number;
  compareAtPriceCents: number | null;
  stock: number;
  position: number;
  /** attributeId -> valueId. Empty for a product with no variant attributes. */
  combination: Record<string, string>;
};

export type EditorAttribute = {
  attributeId: string;
  name: string;
  slug: string;
  kind: "select" | "color" | "number" | "text";
  unit: string | null;
  role: "variant" | "spec";
  position: number;
  /** The values this product offers for this attribute. */
  values: {
    id: string;
    value: string;
    slug: string;
    meta: Record<string, unknown>;
  }[];
};

export async function getProductForEditing(productId: string, storeId: string) {
  const [product] = await db
    .select({
      id: products.id,
      storeId: products.storeId,
      title: products.title,
      slug: products.slug,
      description: products.description,
      categoryId: products.categoryId,
      brandId: products.brandId,
      brandName: brands.name,
      status: products.status,
      stockDisplay: products.stockDisplay,
      lowStockThreshold: products.lowStockThreshold,
    })
    .from(products)
    .leftJoin(brands, eq(brands.id, products.brandId))
    // Scoped to the store, so a product id from elsewhere resolves to nothing
    // rather than opening someone else's listing in an editor.
    .where(and(eq(products.id, productId), eq(products.storeId, storeId)))
    .limit(1);

  if (!product) return null;

  const [
    attributeRows,
    valueRows,
    variantRows,
    variantValueRows,
    tagRows,
    imageRows,
    imageTagRows,
  ] = await Promise.all([
    db
      .select({
        attributeId: productAttributes.attributeId,
        role: productAttributes.role,
        position: productAttributes.position,
        name: attributes.name,
        slug: attributes.slug,
        kind: attributes.kind,
        unit: attributes.unit,
      })
      .from(productAttributes)
      .innerJoin(attributes, eq(attributes.id, productAttributes.attributeId))
      .where(eq(productAttributes.productId, productId))
      .orderBy(asc(productAttributes.position)),

    db
      .select({
        attributeId: productAttributeValues.attributeId,
        valueId: attributeValues.id,
        value: attributeValues.value,
        slug: attributeValues.slug,
        meta: attributeValues.meta,
        position: attributeValues.position,
      })
      .from(productAttributeValues)
      .innerJoin(
        attributeValues,
        eq(attributeValues.id, productAttributeValues.valueId),
      )
      .where(eq(productAttributeValues.productId, productId))
      .orderBy(asc(attributeValues.position)),

    db
      .select({
        id: productVariants.id,
        sku: productVariants.sku,
        priceCents: productVariants.priceCents,
        compareAtPriceCents: productVariants.compareAtPriceCents,
        stock: productVariants.stock,
        position: productVariants.position,
      })
      .from(productVariants)
      .where(eq(productVariants.productId, productId))
      .orderBy(asc(productVariants.position)),

    db
      .select({
        variantId: variantAttributeValues.variantId,
        attributeId: variantAttributeValues.attributeId,
        valueId: variantAttributeValues.valueId,
      })
      .from(variantAttributeValues)
      .innerJoin(
        productVariants,
        eq(productVariants.id, variantAttributeValues.variantId),
      )
      .where(eq(productVariants.productId, productId)),

    db
      .select({ id: tags.id, name: tags.name })
      .from(productTags)
      .innerJoin(tags, eq(tags.id, productTags.tagId))
      .where(eq(productTags.productId, productId)),

    db
      .select({
        id: productImages.id,
        url: productImages.url,
        alt: productImages.alt,
        position: productImages.position,
        blurDataUrl: productImages.blurDataUrl,
      })
      .from(productImages)
      .where(eq(productImages.productId, productId))
      .orderBy(asc(productImages.position)),

    db
      .select({
        imageId: productImageAttributeValues.imageId,
        attributeId: productImageAttributeValues.attributeId,
        valueId: productImageAttributeValues.valueId,
      })
      .from(productImageAttributeValues)
      .innerJoin(
        productImages,
        eq(productImages.id, productImageAttributeValues.imageId),
      )
      .where(eq(productImages.productId, productId)),
  ]);

  // attributeId -> valueId per image, the same shape the storefront gallery
  // matches a shopper's selection against.
  const tagsByImage = new Map<string, Record<string, string>>();
  for (const row of imageTagRows) {
    const current = tagsByImage.get(row.imageId) ?? {};
    current[row.attributeId] = row.valueId;
    tagsByImage.set(row.imageId, current);
  }

  const valuesByAttribute = new Map<string, EditorAttribute["values"]>();
  for (const row of valueRows) {
    const list = valuesByAttribute.get(row.attributeId) ?? [];
    list.push({
      id: row.valueId,
      value: row.value,
      slug: row.slug,
      meta: row.meta ?? {},
    });
    valuesByAttribute.set(row.attributeId, list);
  }

  const combinationByVariant = new Map<string, Record<string, string>>();
  for (const row of variantValueRows) {
    const current = combinationByVariant.get(row.variantId) ?? {};
    current[row.attributeId] = row.valueId;
    combinationByVariant.set(row.variantId, current);
  }

  return {
    ...product,
    tags: tagRows,
    images: imageRows.map((image) => ({
      ...image,
      tags: tagsByImage.get(image.id) ?? {},
    })),
    attributes: attributeRows.map(
      (row): EditorAttribute => ({
        attributeId: row.attributeId,
        name: row.name,
        slug: row.slug,
        kind: row.kind,
        unit: row.unit,
        role: row.role,
        position: row.position,
        values: valuesByAttribute.get(row.attributeId) ?? [],
      }),
    ),
    variants: variantRows.map(
      (row): EditorVariant => ({
        ...row,
        combination: combinationByVariant.get(row.id) ?? {},
      }),
    ),
  };
}

/**
 * The seller's listings, with a rolled-up variant summary.
 *
 * The aggregates are their own grouped query rather than correlated
 * subqueries. Drizzle renders an outer column reference inside a raw sql
 * template unqualified, so `products.id` becomes a bare "id" that Postgres
 * resolves against the subquery's own tables — and product_variants has an
 * `id`. It happens to work here only because the outer join forces
 * qualification; drop the join and it silently returns zeroes.
 */
export async function listProductsForStore(storeId: string, limit = 100) {
  const rows = await db
    .select({
      id: products.id,
      title: products.title,
      slug: products.slug,
      status: products.status,
      updatedAt: products.updatedAt,
      brandName: brands.name,
    })
    .from(products)
    .leftJoin(brands, eq(brands.id, products.brandId))
    .where(eq(products.storeId, storeId))
    .orderBy(desc(products.updatedAt))
    .limit(limit);

  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);

  const [variantRows, imageRows] = await Promise.all([
    db
      .select({
        productId: productVariants.productId,
        variantCount: sql<number>`count(*)::int`,
        stock: sql<number>`coalesce(sum(${productVariants.stock}), 0)::int`,
        minPriceCents: sql<number>`coalesce(min(${productVariants.priceCents}), 0)::int`,
        maxPriceCents: sql<number>`coalesce(max(${productVariants.priceCents}), 0)::int`,
      })
      .from(productVariants)
      .where(inArray(productVariants.productId, ids))
      .groupBy(productVariants.productId),

    db
      .select({
        productId: productImages.productId,
        url: productImages.url,
        position: productImages.position,
      })
      .from(productImages)
      .where(inArray(productImages.productId, ids))
      .orderBy(asc(productImages.position)),
  ]);

  const summary = new Map(variantRows.map((row) => [row.productId, row]));
  // First image per product; the query is already ordered by position.
  const cover = new Map<string, string>();
  for (const image of imageRows) {
    if (!cover.has(image.productId)) cover.set(image.productId, image.url);
  }

  return rows.map((row) => ({
    ...row,
    variantCount: summary.get(row.id)?.variantCount ?? 0,
    stock: summary.get(row.id)?.stock ?? 0,
    minPriceCents: summary.get(row.id)?.minPriceCents ?? 0,
    maxPriceCents: summary.get(row.id)?.maxPriceCents ?? 0,
    imageUrl: cover.get(row.id) ?? null,
  }));
}

/**
 * Approved attributes, for the picker.
 *
 * Only approved ones. A pending attribute is one nobody has agreed belongs in
 * the global vocabulary yet, and offering it here would let the catalogue fill
 * with near-duplicates before anyone reviews them.
 */
export async function listAvailableAttributes() {
  const attributeRows = await db
    .select({
      id: attributes.id,
      name: attributes.name,
      slug: attributes.slug,
      kind: attributes.kind,
      unit: attributes.unit,
      isFilterable: attributes.isFilterable,
    })
    .from(attributes)
    .where(eq(attributes.status, "approved"))
    .orderBy(asc(attributes.position), asc(attributes.name));

  if (attributeRows.length === 0) return [];

  const valueRows = await db
    .select({
      id: attributeValues.id,
      attributeId: attributeValues.attributeId,
      value: attributeValues.value,
      slug: attributeValues.slug,
      meta: attributeValues.meta,
    })
    .from(attributeValues)
    .where(
      and(
        inArray(
          attributeValues.attributeId,
          attributeRows.map((a) => a.id),
        ),
        eq(attributeValues.status, "approved"),
      ),
    )
    .orderBy(asc(attributeValues.position), asc(attributeValues.value));

  const byAttribute = new Map<string, typeof valueRows>();
  for (const row of valueRows) {
    const list = byAttribute.get(row.attributeId) ?? [];
    list.push(row);
    byAttribute.set(row.attributeId, list);
  }

  return attributeRows.map((attribute) => ({
    ...attribute,
    values: (byAttribute.get(attribute.id) ?? []).map((v) => ({
      id: v.id,
      value: v.value,
      slug: v.slug,
      meta: v.meta ?? {},
    })),
  }));
}
