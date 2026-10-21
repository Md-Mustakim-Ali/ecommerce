import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared";
import { user } from "./auth";
import { stores } from "./stores";

/**
 * Content: custom pages, and placements that inject promotional content into
 * pages that already exist.
 *
 * Both are scoped. A store owner (or anyone they grant the permission to)
 * manages content for their own store; platform staff manage it site-wide.
 * The same tables serve both, discriminated by `scope`, so there is one editor
 * and one renderer rather than two that drift.
 */

export const contentScope = pgEnum("content_scope", ["platform", "store"]);

export const contentStatus = pgEnum("content_status", [
  "draft",
  "published",
  "archived",
]);

// ---------------------------------------------------------------------------
// Custom pages
// ---------------------------------------------------------------------------

export const pages = pgTable(
  "pages",
  {
    id: primaryId(),
    scope: contentScope("scope").notNull(),
    /** Null for platform pages. */
    storeId: uuid("store_id").references(() => stores.id, {
      onDelete: "cascade",
    }),

    slug: text("slug").notNull(),
    title: text("title").notNull(),
    /** Short summary for listings and link previews. */
    excerpt: text("excerpt"),

    status: contentStatus("status").notNull().default("draft"),

    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),

    publishedAt: timestamp("published_at", { withTimezone: true }),

    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    updatedBy: text("updated_by").references(() => user.id, {
      onDelete: "set null",
    }),

    ...timestamps,
  },
  (t) => [
    // NULL store_id is distinct in Postgres, so a single unique index would
    // let two platform pages share a slug. Two partial indexes instead.
    uniqueIndex("pages_platform_slug_key")
      .on(t.slug)
      .where(sql`${t.storeId} is null`),
    uniqueIndex("pages_store_slug_key")
      .on(t.storeId, t.slug)
      .where(sql`${t.storeId} is not null`),
    index("pages_scope_status_idx").on(t.scope, t.status),
  ],
);

/**
 * A block on a page.
 *
 * `type` picks which Zod schema validates `data`. Storing block content as
 * JSONB rather than a column per block type means adding a block type is a
 * schema file, not a migration.
 */
export const pageBlocks = pgTable(
  "page_blocks",
  {
    id: primaryId(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    position: integer("position").notNull().default(0),
    data: jsonb("data")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    ...timestamps,
  },
  (t) => [index("page_blocks_page_position_idx").on(t.pageId, t.position)],
);

// ---------------------------------------------------------------------------
// Placements
// ---------------------------------------------------------------------------

export const placementSlot = pgEnum("placement_slot", [
  /** A thin bar pinned above the header. */
  "announcement_bar",
  /** Between the header and the page's own content. */
  "above_content",
  /** After the page's own content. */
  "below_content",
]);

/**
 * Promotional content injected into pages that already exist.
 *
 * This is the half that matters most: an offer banner is rarely wanted on a
 * brand new page. It is wanted on the home page, or across every product page
 * in a category, or on one specific set of pages, for a fortnight.
 *
 * Scheduling lives here rather than being a manual switch somebody has to
 * remember to flip at midnight.
 */
export const placements = pgTable(
  "placements",
  {
    id: primaryId(),
    scope: contentScope("scope").notNull(),
    storeId: uuid("store_id").references(() => stores.id, {
      onDelete: "cascade",
    }),

    /** Same vocabulary as page blocks, so the renderer is shared. */
    type: text("type").notNull(),
    slot: placementSlot("slot").notNull().default("above_content"),
    data: jsonb("data")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),

    /** Higher wins when several placements match the same slot. */
    priority: integer("priority").notNull().default(0),

    status: contentStatus("status").notNull().default("draft"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),

    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [
    index("placements_scope_status_idx").on(t.scope, t.status),
    index("placements_store_idx").on(t.storeId),
    index("placements_window_idx").on(t.startsAt, t.endsAt),
  ],
);

/**
 * Where a placement appears.
 *
 * One row per rule, so several rules make a bundle: "the home page, plus
 * everything under Electronics, plus these two custom pages" is three rows.
 *
 *   everywhere    — every storefront page
 *   home          — the storefront home page
 *   search        — search and category listing pages
 *   cart          — cart and checkout
 *   category      — targetValue is a category slug; matches descendants too
 *   product       — targetValue is a product slug, or null for all products
 *   store         — targetValue is a store slug; every page of that store
 *   page          — targetValue is a custom page slug
 */
export const placementTargetType = pgEnum("placement_target_type", [
  "everywhere",
  "home",
  "search",
  "cart",
  "category",
  "product",
  "store",
  "page",
]);

export const placementTargets = pgTable(
  "placement_targets",
  {
    id: primaryId(),
    placementId: uuid("placement_id")
      .notNull()
      .references(() => placements.id, { onDelete: "cascade" }),
    targetType: placementTargetType("target_type").notNull(),
    /** Null for the broad types (everywhere, home, search, cart). */
    targetValue: text("target_value"),
    /**
     * Turns the rule into an exclusion, so "everywhere except checkout" or
     * "all of Electronics except Headphones" is one placement rather than an
     * enumeration of everything you did want.
     */
    isExclusion: boolean("is_exclusion").notNull().default(false),
  },
  (t) => [
    index("placement_targets_placement_idx").on(t.placementId),
    index("placement_targets_lookup_idx").on(t.targetType, t.targetValue),
  ],
);

export const pagesRelations = relations(pages, ({ one, many }) => ({
  store: one(stores, { fields: [pages.storeId], references: [stores.id] }),
  blocks: many(pageBlocks),
}));

export const pageBlocksRelations = relations(pageBlocks, ({ one }) => ({
  page: one(pages, { fields: [pageBlocks.pageId], references: [pages.id] }),
}));

export const placementsRelations = relations(placements, ({ one, many }) => ({
  store: one(stores, { fields: [placements.storeId], references: [stores.id] }),
  targets: many(placementTargets),
}));

export const placementTargetsRelations = relations(
  placementTargets,
  ({ one }) => ({
    placement: one(placements, {
      fields: [placementTargets.placementId],
      references: [placements.id],
    }),
  }),
);
