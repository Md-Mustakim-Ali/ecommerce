import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  attributes,
  attributeValues,
  brands,
  categories,
  productAttributes,
  productAttributeValues,
  productImageAttributeValues,
  productImages,
  products,
  productTags,
  productVariants,
  reviews,
  savedItems,
  stores,
  tags,
  variantAttributeValues,
} from "@/lib/db/schema";
import { DEFAULT_PER_PAGE, type ProductFilters } from "./filters";

/**
 * Read models for the storefront.
 *
 * Every query here filters to `status = 'active'` and to active stores. A
 * draft product or a suspended seller's listing must never reach a buyer, and
 * making that the default in one place is safer than remembering it per page.
 */

export type ProductListItem = {
  id: string;
  slug: string;
  title: string;
  storeName: string;
  storeSlug: string;
  brandName: string | null;
  /** Lowest variant price. */
  priceCents: number;
  /** Highest variant price. Equal to priceCents when there is one price. */
  maxPriceCents: number;
  /** Lowest compare-at across variants, null when nothing is discounted. */
  compareAtCents: number | null;
  /** Highest compare-at across variants. */
  compareAtMaxCents: number | null;
  stock: number;
  imageUrl: string | null;
  blurDataUrl: string | null;
  /** How many variants exist. 1 means the card can add to cart directly. */
  variantCount: number;
  /** Cheapest in-stock variant, so quick-add never picks a sold-out one. */
  defaultVariantId: string | null;
  ratingAverage: number | null;
  ratingCount: number;
};

/**
 * Aggregated per product rather than per variant.
 *
 * A product with three variants must appear once in a grid, at its lowest
 * price, with its total stock. Joining variants directly would repeat it.
 */
const priceAgg = db
  .select({
    productId: productVariants.productId,
    minPrice: sql<number>`min(${productVariants.priceCents})`.as("min_price"),
    maxPrice: sql<number>`max(${productVariants.priceCents})`.as("max_price"),
    // Both ends, so a discounted product can strike through the whole
    // original range rather than a single number that was never the only price.
    minCompare: sql<number>`min(${productVariants.compareAtPriceCents})`.as(
      "min_compare",
    ),
    maxCompare: sql<number>`max(${productVariants.compareAtPriceCents})`.as(
      "max_compare",
    ),
    totalStock: sql<number>`sum(${productVariants.stock})`.as("total_stock"),
    variantCount: sql<number>`count(*)::int`.as("variant_count"),
    // Cheapest variant that is actually in stock, so the card's quick-add
    // never picks a sold-out one.
    defaultVariantId: sql<
      string | null
    >`(array_agg(${productVariants.id} order by (${productVariants.stock} > 0) desc, ${productVariants.priceCents} asc))[1]`.as(
      "default_variant_id",
    ),
  })
  .from(productVariants)
  .groupBy(productVariants.productId)
  .as("price_agg");

/** Published reviews only — a flagged or removed one must not move the score. */
const reviewAgg = db
  .select({
    productId: reviews.productId,
    average: sql<number>`round(avg(${reviews.rating})::numeric, 2)`.as(
      "rating_avg",
    ),
    count: sql<number>`count(*)::int`.as("rating_count"),
  })
  .from(reviews)
  .where(eq(reviews.status, "published"))
  .groupBy(reviews.productId)
  .as("review_agg");

/** First image by position. */
const primaryImage = db
  .selectDistinctOn([productImages.productId], {
    productId: productImages.productId,
    url: productImages.url,
    blurDataUrl: productImages.blurDataUrl,
  })
  .from(productImages)
  .orderBy(productImages.productId, asc(productImages.position))
  .as("primary_image");

/** Descendant category ids, so /c/electronics includes everything beneath it. */
async function categoryAndDescendants(slug: string): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    with recursive tree as (
      select id from ${categories} where slug = ${slug}
      union all
      select c.id from ${categories} c join tree t on c.parent_id = t.id
    )
    select id from tree
  `);
  return rows.map((r) => r.id);
}

export async function listProducts(filters: ProductFilters = {}) {
  const perPage = filters.perPage ?? DEFAULT_PER_PAGE;
  const page = Math.max(1, filters.page ?? 1);
  const offset = (page - 1) * perPage;

  const conditions = [
    eq(products.status, "active"),
    // A suspended or closed store disappears from the storefront entirely.
    eq(stores.status, "active"),
  ];

  if (filters.categorySlug) {
    const ids = await categoryAndDescendants(filters.categorySlug);
    if (ids.length === 0) return { items: [], total: 0, page, perPage };
    conditions.push(inArray(products.categoryId, ids));
  }

  if (filters.brandSlugs?.length) {
    conditions.push(inArray(brands.slug, filters.brandSlugs));
  }

  if (filters.q?.trim()) {
    // websearch_to_tsquery handles quoted phrases and OR the way a buyer
    // expects, and never throws on malformed input the way to_tsquery does.
    conditions.push(
      sql`${products.searchVector} @@ websearch_to_tsquery('simple', ${filters.q.trim()})`,
    );
  }

  if (filters.minCents !== undefined) {
    conditions.push(gte(priceAgg.minPrice, filters.minCents));
  }
  if (filters.maxCents !== undefined) {
    conditions.push(lte(priceAgg.minPrice, filters.maxCents));
  }

  if (filters.tagSlugs?.length) {
    // EXISTS rather than a join: a product with three matching tags must not
    // appear three times.
    conditions.push(
      sql`exists (
        select 1 from ${productTags} pt
        join ${tags} t on t.id = pt.tag_id
        where pt.product_id = ${products.id}
          and t.slug in ${filters.tagSlugs}
          and t.status = 'approved'
      )`,
    );
  }

  const where = and(...conditions);

  const orderBy = (() => {
    switch (filters.sort) {
      case "price-asc":
        return [asc(priceAgg.minPrice)];
      case "price-desc":
        return [desc(priceAgg.minPrice)];
      case "newest":
        return [desc(products.publishedAt)];
      default:
        return filters.q?.trim()
          ? [
              desc(
                sql`ts_rank(${products.searchVector}, websearch_to_tsquery('simple', ${filters.q.trim()}))`,
              ),
            ]
          : [desc(products.publishedAt)];
    }
  })();

  const base = db
    .select({
      id: products.id,
      slug: products.slug,
      title: products.title,
      storeName: stores.name,
      storeSlug: stores.slug,
      brandName: brands.name,
      priceCents: priceAgg.minPrice,
      maxPriceCents: priceAgg.maxPrice,
      compareAtCents: priceAgg.minCompare,
      compareAtMaxCents: priceAgg.maxCompare,
      stock: priceAgg.totalStock,
      imageUrl: primaryImage.url,
      blurDataUrl: primaryImage.blurDataUrl,
      variantCount: priceAgg.variantCount,
      defaultVariantId: priceAgg.defaultVariantId,
      ratingAverage: reviewAgg.average,
      ratingCount: sql<number>`coalesce(${reviewAgg.count}, 0)`,
    })
    .from(products)
    .innerJoin(stores, eq(stores.id, products.storeId))
    .innerJoin(priceAgg, eq(priceAgg.productId, products.id))
    .leftJoin(brands, eq(brands.id, products.brandId))
    .leftJoin(primaryImage, eq(primaryImage.productId, products.id))
    .leftJoin(reviewAgg, eq(reviewAgg.productId, products.id))
    .where(where);

  const [items, [{ total }]] = await Promise.all([
    base
      .orderBy(...orderBy)
      .limit(perPage)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(products)
      .innerJoin(stores, eq(stores.id, products.storeId))
      .innerJoin(priceAgg, eq(priceAgg.productId, products.id))
      .leftJoin(brands, eq(brands.id, products.brandId))
      .where(where),
  ]);

  return {
    items: items as ProductListItem[],
    total,
    page,
    perPage,
  };
}

export async function getProductBySlug(slug: string) {
  const product = await db
    .select({
      id: products.id,
      slug: products.slug,
      title: products.title,
      description: products.description,
      attributes: products.attributes,
      storeId: stores.id,
      storeName: stores.name,
      storeSlug: stores.slug,
      storeAccent: stores.accentColor,
      brandId: brands.id,
      brandName: brands.name,
      brandSlug: brands.slug,
      categoryId: categories.id,
      categoryName: categories.name,
      categorySlug: categories.slug,
    })
    .from(products)
    .innerJoin(stores, eq(stores.id, products.storeId))
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(brands, eq(brands.id, products.brandId))
    .where(
      and(
        eq(products.slug, slug),
        eq(products.status, "active"),
        eq(stores.status, "active"),
      ),
    )
    .limit(1);

  if (product.length === 0) return null;
  const row = product[0];

  const [variants, images, productTagRows, variantCombos, imageTags, attrRows] =
    await Promise.all([
      db
        .select()
        .from(productVariants)
        .where(eq(productVariants.productId, row.id))
        .orderBy(asc(productVariants.position)),
      db
        .select()
        .from(productImages)
        .where(eq(productImages.productId, row.id))
        .orderBy(asc(productImages.position)),
      db
        .select({ name: tags.name, slug: tags.slug })
        .from(productTags)
        .innerJoin(tags, eq(tags.id, productTags.tagId))
        .where(
          and(eq(productTags.productId, row.id), eq(tags.status, "approved")),
        ),
      // Which combination each variant is. The set of these rows IS the set of
      // valid combinations — a pairing with no variant simply does not exist.
      db
        .select({
          variantId: variantAttributeValues.variantId,
          attributeId: variantAttributeValues.attributeId,
          attributeSlug: attributes.slug,
          valueId: variantAttributeValues.valueId,
        })
        .from(variantAttributeValues)
        .innerJoin(
          productVariants,
          eq(productVariants.id, variantAttributeValues.variantId),
        )
        .innerJoin(
          attributes,
          eq(attributes.id, variantAttributeValues.attributeId),
        )
        .where(eq(productVariants.productId, row.id)),
      // Image tags, so picking a colour can jump the gallery to that photo.
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
        .where(eq(productImages.productId, row.id)),
      db
        .select({
          attributeId: attributes.id,
          slug: attributes.slug,
          name: attributes.name,
          kind: attributes.kind,
          unit: attributes.unit,
          role: productAttributes.role,
          position: productAttributes.position,
          valueId: attributeValues.id,
          value: attributeValues.value,
          valueSlug: attributeValues.slug,
          valueMeta: attributeValues.meta,
          valuePosition: attributeValues.position,
        })
        .from(productAttributes)
        .innerJoin(attributes, eq(attributes.id, productAttributes.attributeId))
        .innerJoin(
          productAttributeValues,
          and(
            eq(productAttributeValues.productId, productAttributes.productId),
            eq(
              productAttributeValues.attributeId,
              productAttributes.attributeId,
            ),
          ),
        )
        .innerJoin(
          attributeValues,
          eq(attributeValues.id, productAttributeValues.valueId),
        )
        .where(eq(productAttributes.productId, row.id))
        .orderBy(
          asc(productAttributes.position),
          asc(attributeValues.position),
        ),
    ]);

  // Assemble the attribute definitions the product actually offers.
  const attributeMap = new Map<
    string,
    {
      id: string;
      slug: string;
      name: string;
      kind: string;
      unit: string | null;
      role: "variant" | "spec";
      values: {
        id: string;
        value: string;
        slug: string;
        meta: Record<string, unknown>;
      }[];
    }
  >();

  for (const attrRow of attrRows) {
    let entry = attributeMap.get(attrRow.attributeId);
    if (!entry) {
      entry = {
        id: attrRow.attributeId,
        slug: attrRow.slug,
        name: attrRow.name,
        kind: attrRow.kind,
        unit: attrRow.unit,
        role: attrRow.role,
        values: [],
      };
      attributeMap.set(attrRow.attributeId, entry);
    }
    if (!entry.values.some((v) => v.id === attrRow.valueId)) {
      entry.values.push({
        id: attrRow.valueId,
        value: attrRow.value,
        slug: attrRow.valueSlug,
        meta: attrRow.valueMeta ?? {},
      });
    }
  }

  const combosByVariant = new Map<string, Record<string, string>>();
  for (const combo of variantCombos) {
    const existing = combosByVariant.get(combo.variantId) ?? {};
    existing[combo.attributeId] = combo.valueId;
    combosByVariant.set(combo.variantId, existing);
  }

  const tagsByImage = new Map<string, Record<string, string>>();
  for (const tag of imageTags) {
    const existing = tagsByImage.get(tag.imageId) ?? {};
    existing[tag.attributeId] = tag.valueId;
    tagsByImage.set(tag.imageId, existing);
  }

  return {
    ...row,
    variants: variants.map((variant) => ({
      ...variant,
      /** attributeId -> valueId. Empty for an option-less default variant. */
      combination: combosByVariant.get(variant.id) ?? {},
    })),
    images: images.map((image) => ({
      ...image,
      /** attributeId -> valueId. Empty when the image is not option-specific. */
      tags: tagsByImage.get(image.id) ?? {},
    })),
    tags: productTagRows,
    attributes: [...attributeMap.values()],
  };
}

export type CategoryNode = {
  id: string;
  name: string;
  slug: string;
  children: CategoryNode[];
};

/** The whole tree in one query, assembled in memory. Small and cacheable. */
export async function getCategoryTree(): Promise<CategoryNode[]> {
  const rows = await db
    .select({
      id: categories.id,
      parentId: categories.parentId,
      name: categories.name,
      slug: categories.slug,
      position: categories.position,
    })
    .from(categories)
    .orderBy(asc(categories.position), asc(categories.name));

  const byId = new Map<string, CategoryNode>();
  for (const row of rows) {
    byId.set(row.id, {
      id: row.id,
      name: row.name,
      slug: row.slug,
      children: [],
    });
  }

  const roots: CategoryNode[] = [];
  for (const row of rows) {
    const node = byId.get(row.id);
    if (!node) continue;
    if (row.parentId) byId.get(row.parentId)?.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** Facets for the filter panel, counted against the current result set. */
export async function getBrandFacets(categorySlug?: string) {
  const conditions = [
    eq(products.status, "active"),
    eq(stores.status, "active"),
    eq(brands.status, "approved"),
  ];

  if (categorySlug) {
    const ids = await categoryAndDescendants(categorySlug);
    if (ids.length === 0) return [];
    conditions.push(inArray(products.categoryId, ids));
  }

  return db
    .select({
      name: brands.name,
      slug: brands.slug,
      count: sql<number>`count(*)::int`,
    })
    .from(products)
    .innerJoin(stores, eq(stores.id, products.storeId))
    .innerJoin(brands, eq(brands.id, products.brandId))
    .where(and(...conditions))
    .groupBy(brands.name, brands.slug)
    .orderBy(desc(sql`count(*)`))
    .limit(20);
}

export async function getCategoryBySlug(slug: string) {
  const [row] = await db
    .select({ id: categories.id, name: categories.name, slug: categories.slug })
    .from(categories)
    .where(eq(categories.slug, slug))
    .limit(1);
  return row ?? null;
}

/**
 * Which of these products the current user has saved.
 *
 * Deliberately a second query rather than a join on listProducts: the listing
 * is identical for everyone and therefore cacheable, and folding a per-user
 * column into it would make every grid render user-specific.
 */
export async function getSavedProductIds(
  userId: string | null,
  productIds: string[],
): Promise<Set<string>> {
  if (!userId || productIds.length === 0) return new Set();

  const rows = await db
    .select({ productId: savedItems.productId })
    .from(savedItems)
    .where(
      and(
        eq(savedItems.userId, userId),
        inArray(savedItems.productId, productIds),
      ),
    );

  return new Set(rows.map((r) => r.productId));
}
