import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
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
import {
  catalogTermStatus,
  productImages,
  products,
  productVariants,
} from "./catalog";

/**
 * Product attributes: size, colour, material, capacity.
 *
 * Platform-level and deduplicated, exactly like brands and tags. If every
 * store invents its own "Colour", "colour", "Color" and "Colours", the
 * storefront cannot offer a single colour filter across the catalogue — which
 * is the whole point of having them.
 *
 * Two distinct jobs, separated by `role` on product_attributes:
 *
 *   variant — drives the variant matrix. Size and colour pick a SKU, and each
 *             combination carries its own price and stock.
 *   spec    — describes the product and filters it, but does not split it into
 *             variants. Screen size, fabric, wattage.
 */

export const attributeKind = pgEnum("attribute_kind", [
  /** A fixed list of values. The common case. */
  "select",
  /** Like select, but values carry a swatch colour in `meta`. */
  "color",
  /** Numeric, so filters can offer a range rather than checkboxes. */
  "number",
  /** Free text. Never filterable — unbounded values make a useless facet. */
  "text",
]);

export const attributes = pgTable(
  "attributes",
  {
    id: primaryId(),
    name: text("name").notNull(),
    /** The deduplication key. Same normalisation as brands and tags. */
    slug: text("slug").notNull(),

    kind: attributeKind("kind").notNull().default("select"),
    /** e.g. "cm", "GB". Display only. */
    unit: text("unit"),

    /** Whether this appears as a storefront filter facet. */
    isFilterable: boolean("is_filterable").notNull().default(true),
    position: integer("position").notNull().default(0),

    status: catalogTermStatus("status").notNull().default("pending"),
    mergedIntoId: uuid("merged_into_id").references(
      (): AnyPgColumn => attributes.id,
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
    uniqueIndex("attributes_slug_key").on(t.slug),
    index("attributes_status_idx").on(t.status),
    index("attributes_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`),
  ],
);

/**
 * The allowed values for an attribute, also deduplicated.
 *
 * "Navy" must be one value across the whole catalogue, or the colour filter
 * lists it four times.
 */
export const attributeValues = pgTable(
  "attribute_values",
  {
    id: primaryId(),
    attributeId: uuid("attribute_id")
      .notNull()
      .references(() => attributes.id, { onDelete: "cascade" }),

    value: text("value").notNull(),
    slug: text("slug").notNull(),

    /** e.g. { "hex": "#1b2a4a" } for a colour swatch, { "numeric": 42 } for sorting. */
    meta: jsonb("meta")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),

    position: integer("position").notNull().default(0),

    status: catalogTermStatus("status").notNull().default("pending"),
    mergedIntoId: uuid("merged_into_id").references(
      (): AnyPgColumn => attributeValues.id,
      { onDelete: "set null" },
    ),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),

    ...timestamps,
  },
  (t) => [
    // Scoped to the attribute: "small" under Size and "small" under Capacity
    // are different values and must not collide.
    uniqueIndex("attribute_values_attribute_slug_key").on(
      t.attributeId,
      t.slug,
    ),
    index("attribute_values_attribute_idx").on(t.attributeId, t.position),
    index("attribute_values_trgm_idx").using(
      "gin",
      sql`${t.value} gin_trgm_ops`,
    ),
  ],
);

export const productAttributeRole = pgEnum("product_attribute_role", [
  "variant",
  "spec",
]);

/** Which attributes a product uses, and in which role. */
export const productAttributes = pgTable(
  "product_attributes",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    attributeId: uuid("attribute_id")
      .notNull()
      .references(() => attributes.id, { onDelete: "restrict" }),
    role: productAttributeRole("role").notNull().default("variant"),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.attributeId] }),
    index("product_attributes_attribute_idx").on(t.attributeId),
  ],
);

/**
 * The values this product offers, i.e. its option set.
 *
 * Also what the storefront filters against — filtering on variants directly
 * would need a DISTINCT to avoid returning a product once per matching variant.
 */
export const productAttributeValues = pgTable(
  "product_attribute_values",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    attributeId: uuid("attribute_id")
      .notNull()
      .references(() => attributes.id, { onDelete: "restrict" }),
    valueId: uuid("value_id")
      .notNull()
      .references(() => attributeValues.id, { onDelete: "restrict" }),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.valueId] }),
    index("product_attribute_values_value_idx").on(t.valueId),
    index("product_attribute_values_attribute_idx").on(t.attributeId),
  ],
);

/**
 * Which combination each variant is.
 *
 * This is how invalid combinations are handled, and why there is no separate
 * "allowed combinations" table: the set of variants IS the set of valid
 * combinations. If Large does not come in Navy, that variant simply does not
 * exist, and the storefront shows the pairing as unavailable because no SKU
 * matches it.
 *
 * Per-combination pricing falls out for free — price and stock already live on
 * product_variants, so Large/Navy costing more than Small/Navy needs no extra
 * modelling.
 */
export const variantAttributeValues = pgTable(
  "variant_attribute_values",
  {
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    attributeId: uuid("attribute_id")
      .notNull()
      .references(() => attributes.id, { onDelete: "restrict" }),
    valueId: uuid("value_id")
      .notNull()
      .references(() => attributeValues.id, { onDelete: "restrict" }),
  },
  (t) => [
    // One value per attribute per variant. A variant cannot be both Navy and
    // Charcoal.
    primaryKey({ columns: [t.variantId, t.attributeId] }),
    index("variant_attribute_values_value_idx").on(t.valueId),
  ],
);

export const attributesRelations = relations(attributes, ({ many, one }) => ({
  values: many(attributeValues),
  mergedInto: one(attributes, {
    fields: [attributes.mergedIntoId],
    references: [attributes.id],
    relationName: "attribute_merge",
  }),
}));

export const attributeValuesRelations = relations(
  attributeValues,
  ({ one }) => ({
    attribute: one(attributes, {
      fields: [attributeValues.attributeId],
      references: [attributes.id],
    }),
  }),
);

export const productAttributesRelations = relations(
  productAttributes,
  ({ one }) => ({
    product: one(products, {
      fields: [productAttributes.productId],
      references: [products.id],
    }),
    attribute: one(attributes, {
      fields: [productAttributes.attributeId],
      references: [attributes.id],
    }),
  }),
);

export const variantAttributeValuesRelations = relations(
  variantAttributeValues,
  ({ one }) => ({
    variant: one(productVariants, {
      fields: [variantAttributeValues.variantId],
      references: [productVariants.id],
    }),
    attribute: one(attributes, {
      fields: [variantAttributeValues.attributeId],
      references: [attributes.id],
    }),
    value: one(attributeValues, {
      fields: [variantAttributeValues.valueId],
      references: [attributeValues.id],
    }),
  }),
);

/**
 * Links a product image to an attribute value, or to a combination of them.
 *
 * This is what makes the gallery react to the option picker. An image tagged
 * only with Colour=Navy matches every Navy variant; one tagged Colour=Navy and
 * Size=L matches just that pairing. When a shopper picks a colour, the gallery
 * jumps to the photo of that colour instead of showing them the wrong one.
 *
 * Matching is subset-based and most-specific-wins: an image matches when every
 * tag it carries is satisfied by the current selection, and the image with the
 * most matching tags is the one shown. That way a general Navy photo still
 * works when no Navy/Large photo has been uploaded.
 */
export const productImageAttributeValues = pgTable(
  "product_image_attribute_values",
  {
    imageId: uuid("image_id")
      .notNull()
      .references(() => productImages.id, { onDelete: "cascade" }),
    attributeId: uuid("attribute_id")
      .notNull()
      .references(() => attributes.id, { onDelete: "cascade" }),
    valueId: uuid("value_id")
      .notNull()
      .references(() => attributeValues.id, { onDelete: "cascade" }),
  },
  (t) => [
    // One value per attribute per image: an image cannot be both Navy and Rust.
    primaryKey({ columns: [t.imageId, t.attributeId] }),
    index("product_image_attr_value_idx").on(t.valueId),
  ],
);

export const productImageAttributeValuesRelations = relations(
  productImageAttributeValues,
  ({ one }) => ({
    image: one(productImages, {
      fields: [productImageAttributeValues.imageId],
      references: [productImages.id],
    }),
    attribute: one(attributes, {
      fields: [productImageAttributeValues.attributeId],
      references: [attributes.id],
    }),
    value: one(attributeValues, {
      fields: [productImageAttributeValues.valueId],
      references: [attributeValues.id],
    }),
  }),
);
