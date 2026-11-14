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
import { storeGoogleAccounts } from "./media";
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

/**
 * What a product does once its media finishes uploading.
 *
 * `when_media_ready` exists because seller-supplied media does not become
 * usable at the moment it is accepted. A Drive file has to finish syncing and
 * a YouTube video has to finish transcoding, and publishing before either is
 * done ships a listing with a broken image or a "processing" placeholder where
 * a video should be. The alternative is asking the seller to come back and
 * press publish at a moment only Google knows.
 */
export const productPublishMode = pgEnum("product_publish_mode", [
  /** Stays draft until the seller publishes it, media or no media. */
  "manual",
  /** Publishes itself the moment the last asset reports ready. */
  "when_media_ready",
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

    /**
     * The flattened plain text of descriptionDoc, and the column search reads.
     *
     * Kept in sync on every write rather than derived at query time, because
     * searchVector below is a GENERATED column and a generated column cannot
     * reach into jsonb. Dropping this in favour of the document alone would
     * silently remove every rich description from search results — the query
     * would still run, just never match.
     *
     * Also the fallback for products written before rich text existed, which
     * have a description and no document.
     */
    description: text("description"),

    /**
     * The rich description. See lib/rich-text/schema.ts.
     *
     * Null means this product predates rich text (or the seller cleared it),
     * in which case `description` is rendered as plain paragraphs.
     */
    descriptionDoc: jsonb("description_doc").$type<Record<string, unknown>>(),

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

    publishMode: productPublishMode("publish_mode").notNull().default("manual"),

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

/** An image the platform hosts, a Drive file, or a video on YouTube. */
export const mediaKind = pgEnum("media_kind", ["image", "video"]);

export const mediaProvider = pgEnum("media_provider", [
  /** Uploaded through lib/storage — R2 in production, local disk in dev. */
  "managed",
  /** Lives in a seller's Google Drive. */
  "drive",
  /** Lives on a seller's YouTube channel. */
  "youtube",
]);

/**
 * Where an asset is between "seller picked a file" and "a buyer can see it".
 *
 * Platform uploads go straight to `ready` — lib/storage returns a URL that
 * works. Everything else has a gap: a Drive file has to finish syncing, and a
 * YouTube video has to finish transcoding, which can take half an hour for a
 * large one. `unavailable` is the state nobody expects and everybody needs —
 * an asset that was ready and has since been deleted or made private at the
 * source, six weeks after the product went live.
 */
export const mediaState = pgEnum("media_state", [
  /** Accepted, waiting for capacity. See lib/media/picker.ts. */
  "queued",
  "uploading",
  /** Google has the bytes and is still processing them. */
  "processing",
  "ready",
  /** Gave up. failureReason says why. */
  "failed",
  /** Was ready, has since disappeared at the source. */
  "unavailable",
]);

/**
 * Where an asset appears.
 *
 * Both live in this table on purpose — a description embed goes through the
 * identical upload path, readiness gate and failover as a gallery photo, and
 * splitting them into two tables would mean two of everything and an eventual
 * drift between them. The column exists so that a photo embedded halfway down
 * a description never wins the position-0 slot and turns up as the product's
 * cart thumbnail.
 */
export const mediaPlacement = pgEnum("media_placement", [
  "gallery",
  "description",
]);

export const productImages = pgTable(
  "product_images",
  {
    id: primaryId(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),

    kind: mediaKind("kind").notNull().default("image"),
    provider: mediaProvider("provider").notNull().default("managed"),
    placement: mediaPlacement("placement").notNull().default("gallery"),

    /**
     * Nullable now, because a queued Drive upload or a YouTube video that is
     * still transcoding has no URL yet. Every read path that renders media has
     * to filter on state rather than assume this is populated.
     */
    url: text("url"),
    /** Drive fileId or YouTube videoId. Null for managed uploads. */
    providerRef: text("provider_ref"),

    /**
     * Which connected account holds it.
     *
     * Needed to delete the asset later: only the account that uploaded a file
     * can remove it. `set null` rather than cascade — disconnecting an account
     * must not silently delete the product's media rows, because then nobody
     * can see what broke. The row survives, goes `unavailable`, and says so.
     */
    googleAccountId: uuid("google_account_id").references(
      () => storeGoogleAccounts.id,
      { onDelete: "set null" },
    ),

    state: mediaState("state").notNull().default("ready"),

    /**
     * A resumable upload session, kept so a dropped connection resumes rather
     * than restarts. On a 1,600-unit budget that is the difference between
     * losing a retry and losing a quarter of the day's uploads.
     */
    uploadSessionUri: text("upload_session_uri"),

    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    checkAttempts: integer("check_attempts").notNull().default(0),
    failureReason: text("failure_reason"),

    alt: text("alt"),
    position: integer("position").notNull().default(0),
    /** Base64 LQIP. Without it every image load shifts the layout. */
    blurDataUrl: text("blur_data_url"),
    width: integer("width"),
    height: integer("height"),
    /** Video only. Drives the duration badge on the gallery thumbnail. */
    durationSeconds: integer("duration_seconds"),

    ...timestamps,
  },
  (t) => [
    index("product_images_product_position_idx").on(t.productId, t.position),
    // The publish gate asks "does this product have anything not ready", and
    // the sweeper asks "what is outstanding across every store". Both are this
    // index.
    index("product_images_state_idx").on(t.state, t.lastCheckedAt),
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
