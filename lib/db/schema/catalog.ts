import { relations, type SQL, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared";
import { user } from "./auth";
import { stores } from "./stores";

const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});

/**
 * Shared lifecycle for platform-level catalog terms (brands and tags).
 *
 * `merged` is the important one. When an admin merges "Samsng" into "Samsung",
 * the loser is not deleted — it keeps a pointer at the survivor so any product
 * still referencing it resolves instead of breaking, and so the merge itself
 * stays visible in the audit trail.
 */
export const catalogTermStatus = pgEnum("catalog_term_status", [
  "pending",
  "approved",
  "rejected",
  "merged",
]);

// ---------------------------------------------------------------------------
// Brands — platform-level. A store does not own "Samsung", it just sells it.
// ---------------------------------------------------------------------------

export const brands = pgTable(
  "brands",
  {
    id: primaryId(),

    name: text("name").notNull(),

    /**
     * The deduplication key, produced by slugify() in lib/catalog/normalize.ts.
     * The unique index on this column is what actually prevents duplicates;
     * everything else in the workflow is there to make the rejection friendly
     * rather than a raw constraint violation.
     */
    slug: text("slug").notNull(),

    logoUrl: text("logo_url"),

    status: catalogTermStatus("status").notNull().default("pending"),

    /** Set when status is 'merged'. Points at the surviving brand. */
    mergedIntoId: uuid("merged_into_id").references(
      (): AnyPgColumn => brands.id,
      { onDelete: "set null" },
    ),

    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    approvedBy: text("approved_by").references(() => user.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),

    ...timestamps,
  },
  (t) => [
    uniqueIndex("brands_slug_key").on(t.slug),
    index("brands_status_idx").on(t.status),
    // Trigram index for the near-match warning shown when a seller proposes a
    // new brand. Slug uniqueness catches "Samsung" twice; only similarity
    // catches "Samsng".
    index("brands_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`),
  ],
);

// ---------------------------------------------------------------------------
// Tags — same deduplication treatment as brands.
// ---------------------------------------------------------------------------

export const tags = pgTable(
  "tags",
  {
    id: primaryId(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),

    status: catalogTermStatus("status").notNull().default("pending"),
    mergedIntoId: uuid("merged_into_id").references(
      (): AnyPgColumn => tags.id,
      { onDelete: "set null" },
    ),

    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    approvedBy: text("approved_by").references(() => user.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),

    ...timestamps,
  },
  (t) => [
    uniqueIndex("tags_slug_key").on(t.slug),
    index("tags_status_idx").on(t.status),
    index("tags_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`),
  ],
);

// ---------------------------------------------------------------------------
// Categories — a global tree. Sellers pick from it, they do not extend it.
// ---------------------------------------------------------------------------

export const categories = pgTable(
  "categories",
  {
    id: primaryId(),
    parentId: uuid("parent_id").references((): AnyPgColumn => categories.id, {
      onDelete: "restrict",
    }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("categories_slug_key").on(t.slug),
    index("categories_parent_position_idx").on(t.parentId, t.position),
  ],
);

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

/**
 * How much stock detail a buyer sees.
 *
 * Sellers disagree about this and both positions are reasonable: an exact
 * count is honest and creates urgency, but it also tells a competitor your
 * inventory. `when_low` is the default because a number is most useful
 * precisely when it is small.
 */
export const stockDisplay = pgEnum("stock_display", [
  /** Never a number. Just in stock or sold out. */
  "never",
  /** Always the exact count. */
  "always",
  /** The count only once it drops to lowStockThreshold or below. */
  "when_low",
]);

export const productStatus = pgEnum("product_status", [
  "draft",
  "active",
  "archived",
]);

export const products = pgTable(
  "products",
  {
    id: primaryId(),

    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),

    /** Nullable. Not everything has a brand. */
    brandId: uuid("brand_id").references(() => brands.id, {
      onDelete: "set null",
    }),

    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),

    title: text("title").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),

    status: productStatus("status").notNull().default("draft"),

    /** Category-specific fields. Structured data stays in real columns. */
    attributes: jsonb("attributes")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),

    /**
     * Denormalised brand and tag names, maintained by the application.
     *
     * A generated column can only read its own row, so brand and tag names
     * cannot be joined into the tsvector directly. Caching them here keeps
     * search a single index scan instead of a join, at the cost of a rewrite
     * when a brand is renamed or merged.
     */
    searchKeywords: text("search_keywords").notNull().default(""),

    searchVector: tsvector("search_vector").generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('simple', coalesce(${products.title}, '')), 'A') || setweight(to_tsvector('simple', coalesce(${products.searchKeywords}, '')), 'B') || setweight(to_tsvector('simple', coalesce(${products.description}, '')), 'C')`,
    ),

    /**
     * Stock display is per product, decided by whoever manages the catalogue.
     * The quantity itself always comes from the selected variant, never from
     * the product total — a product with 40 units across ten combinations has
     * 4 of the one you actually want.
     */
    stockDisplay: stockDisplay("stock_display").notNull().default("when_low"),
    lowStockThreshold: integer("low_stock_threshold").notNull().default(5),

    publishedAt: timestamp("published_at", { withTimezone: true }),

    ...timestamps,
  },
  (t) => [
    uniqueIndex("products_store_slug_key").on(t.storeId, t.slug),
    index("products_store_status_idx").on(t.storeId, t.status),
    index("products_category_status_idx").on(t.categoryId, t.status),
    index("products_brand_idx").on(t.brandId),
    index("products_search_idx").using("gin", t.searchVector),
  ],
);

export const productImages = pgTable(
  "product_images",
  {
    id: primaryId(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    alt: text("alt"),
    position: integer("position").notNull().default(0),
    /** Base64 LQIP. Without it every image load shifts the layout. */
    blurDataUrl: text("blur_data_url"),
    width: integer("width"),
    height: integer("height"),
    ...timestamps,
  },
  (t) => [
    index("product_images_product_position_idx").on(t.productId, t.position),
  ],
);

export const productVariants = pgTable(
  "product_variants",
  {
    id: primaryId(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),

    /** Unique per store, not globally — two stores may use the same SKU. */
    sku: text("sku").notNull(),

    /** e.g. { "size": "M", "color": "Navy" } */
    optionValues: jsonb("option_values")
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),

    // Always integer minor units. Never floating point, anywhere, ever.
    priceCents: integer("price_cents").notNull(),
    compareAtPriceCents: integer("compare_at_price_cents"),

    stock: integer("stock").notNull().default(0),
    weightGrams: integer("weight_grams"),

    position: integer("position").notNull().default(0),

    ...timestamps,
  },
  (t) => [
    index("product_variants_product_idx").on(t.productId),
    index("product_variants_sku_idx").on(t.sku),
  ],
);

export const productTags = pgTable(
  "product_tags",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.tagId] }),
    index("product_tags_tag_idx").on(t.tagId),
  ],
);

// ---------------------------------------------------------------------------

export const brandsRelations = relations(brands, ({ one, many }) => ({
  mergedInto: one(brands, {
    fields: [brands.mergedIntoId],
    references: [brands.id],
    relationName: "brand_merge",
  }),
  products: many(products),
}));

export const tagsRelations = relations(tags, ({ one, many }) => ({
  mergedInto: one(tags, {
    fields: [tags.mergedIntoId],
    references: [tags.id],
    relationName: "tag_merge",
  }),
  productTags: many(productTags),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: "category_tree",
  }),
  children: many(categories, { relationName: "category_tree" }),
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  store: one(stores, { fields: [products.storeId], references: [stores.id] }),
  brand: one(brands, { fields: [products.brandId], references: [brands.id] }),
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
  images: many(productImages),
  variants: many(productVariants),
  tags: many(productTags),
}));

export const productVariantsRelations = relations(
  productVariants,
  ({ one }) => ({
    product: one(products, {
      fields: [productVariants.productId],
      references: [products.id],
    }),
  }),
);

export const productImagesRelations = relations(productImages, ({ one }) => ({
  product: one(products, {
    fields: [productImages.productId],
    references: [products.id],
  }),
}));

export const productTagsRelations = relations(productTags, ({ one }) => ({
  product: one(products, {
    fields: [productTags.productId],
    references: [products.id],
  }),
  tag: one(tags, { fields: [productTags.tagId], references: [tags.id] }),
}));
