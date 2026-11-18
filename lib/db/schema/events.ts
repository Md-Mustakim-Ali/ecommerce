import { sql } from "drizzle-orm";
import {
  bigint,
  date,
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
import { primaryId } from "./_shared";
import { products, productVariants } from "./catalog";
import { stores } from "./stores";

/**
 * What people did, as opposed to what they bought.
 *
 * Until this existed the shop could answer "what sold" and nothing else — not
 * what was looked at, searched for, or abandoned. The heat grids said so on
 * their own page, which was honest and not a substitute for the data.
 *
 * ── Two tables, and the second is the important one ──────────────────────
 *
 * `analytics_events` is the raw stream: one row per thing that happened, kept
 * briefly. `analytics_daily` is a counter per day per thing, written by the
 * same request that writes the raw row.
 *
 * That looks redundant and is not. A heat grid asks "units per product per
 * week for twelve weeks", and answering it from raw rows means scanning every
 * view this shop has ever served, every time somebody opens the page — on a
 * database that scales to zero and bills for compute. Against the counter it
 * is a few hundred rows. The raw stream is for looking at what actually
 * happened when a number seems wrong, which is a rare, deliberate act, so it
 * is kept for days rather than for ever and swept on the schedule that already
 * exists for orders and media.
 *
 * ── What is deliberately not stored ──────────────────────────────────────
 *
 * No IP address, no user agent string, no fingerprint. A session id that is a
 * random value in a cookie, rotated by the browser clearing it, is enough to
 * ask "how many people" without building a profile of anybody. Bot filtering
 * happens at the edge on the user agent and the header is then discarded — see
 * app/api/events/route.ts.
 */

export const analyticsEventType = pgEnum("analytics_event_type", [
  /** Any page. `path` says which. */
  "page_view",
  /** A product page specifically, with product and store attached. */
  "product_view",
  /** A search was run. The terms live in `meta.q`. */
  "search",
  /** A product card or link was clicked, wherever it appeared. */
  "product_click",
  /** Something was added to a basket. */
  "add_to_cart",
  "remove_from_cart",
  "wishlist_add",
  "wishlist_remove",
  /** The checkout page was opened. */
  "checkout_start",
  /**
   * A tracked control was pressed.
   *
   * This is the catch-all "every button" case, and it is opt-in per element
   * rather than global: an element carries `data-track` and is counted, and
   * everything else is not. Counting every click in the document produces
   * noise nobody reads and a bill somebody pays.
   */
  "ui_click",
]);

export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: primaryId(),

    type: analyticsEventType("type").notNull(),

    /**
     * A random per-browser value, not an identity.
     *
     * Lets "one person looked at six products" be told apart from "six people
     * looked at one", which is the difference between a popular product and a
     * confused shopper. Rotates whenever cookies are cleared, which is the
     * point.
     */
    sessionId: text("session_id").notNull(),

    /** Set when signed in. Null is the normal case on a guest-heavy shop. */
    userId: text("user_id"),

    /*
      Scoping columns. Nullable because not every event has one: a search
      belongs to no store, a page view of the home page to no product.
    */
    storeId: uuid("store_id").references(() => stores.id, {
      onDelete: "cascade",
    }),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "cascade",
    }),
    variantId: uuid("variant_id").references(() => productVariants.id, {
      onDelete: "set null",
    }),

    /** The page it happened on. Query strings stripped before storing. */
    path: text("path"),
    /** Which control, for ui_click and product_click. */
    label: text("label"),

    /** Anything else the event carries: search terms, position in a list. */
    meta: jsonb("meta").$type<Record<string, unknown>>(),

    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The sweep: delete everything older than the retention window.
    index("analytics_events_occurred_idx").on(t.occurredAt),
    // "What happened to this product recently", the debugging question.
    index("analytics_events_product_idx").on(t.productId, t.occurredAt),
    index("analytics_events_store_idx").on(t.storeId, t.occurredAt),
    index("analytics_events_session_idx").on(t.sessionId, t.occurredAt),
  ],
);

/**
 * The counters the dashboards actually read.
 *
 * One row per day per (store, product, variant, type). Written by an upsert on
 * every event, so it is always current and there is no rollup job to fall
 * behind or fail silently — the failure mode of a nightly aggregation is a
 * dashboard that is quietly a day stale, and nobody notices for a week.
 *
 * `sessions` is counted separately from `events` because they answer different
 * questions: forty views from one browser is not the same as forty people, and
 * a product page that one person refreshes is not popular. It is maintained by
 * the ingest endpoint, which knows whether it has already seen that session for
 * that key today.
 */
export const analyticsDaily = pgTable(
  "analytics_daily",
  {
    id: primaryId(),

    /** The day in the shop's timezone, not UTC — see lib/datetime/format.ts. */
    day: date("day").notNull(),
    type: analyticsEventType("type").notNull(),

    storeId: uuid("store_id").references(() => stores.id, {
      onDelete: "cascade",
    }),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "cascade",
    }),
    variantId: uuid("variant_id").references(() => productVariants.id, {
      onDelete: "set null",
    }),

    /** How many times it happened. */
    events: bigint("events", { mode: "number" }).notNull().default(0),
    /** How many distinct browsers did it. Always <= events. */
    sessions: integer("sessions").notNull().default(0),
  },
  (t) => [
    /*
      The upsert target, written as expressions rather than plain columns.

      Postgres treats NULLs as distinct in a unique index, so a plain one over
      these columns would let a single (day, type) with a null product
      accumulate unlimited duplicate rows and silently double every count. The
      fix for that is NULLS NOT DISTINCT, which the drizzle version here cannot
      express — and hand-editing the generated SQL would leave the snapshot
      describing an index that is not the one in the database, so the next
      `generate` would try to correct it back.

      Coalescing to the nil UUID gets the same guarantee through a plain unique
      index. The ingest upsert repeats these exact expressions in its ON
      CONFLICT clause, which is how Postgres infers the index.
    */
    uniqueIndex("analytics_daily_key").on(
      t.day,
      t.type,
      sql`coalesce(${t.storeId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`coalesce(${t.productId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`coalesce(${t.variantId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),

    index("analytics_daily_store_day_idx").on(t.storeId, t.day),
    index("analytics_daily_product_day_idx").on(t.productId, t.day),
    index("analytics_daily_type_day_idx").on(t.type, t.day),
  ],
);

/**
 * Which sessions have already been counted for a key today.
 *
 * Exists only so `analytics_daily.sessions` can be a real distinct count
 * without a `count(distinct …)` over the raw stream. Swept with the raw
 * events, and the row is tiny.
 */
export const analyticsDailySessions = pgTable(
  "analytics_daily_sessions",
  {
    day: date("day").notNull(),
    type: analyticsEventType("type").notNull(),
    storeId: uuid("store_id"),
    productId: uuid("product_id"),
    sessionId: text("session_id").notNull(),
  },
  (t) => [
    // Same coalesce treatment, for the same reason as analytics_daily_key.
    uniqueIndex("analytics_daily_sessions_key").on(
      t.day,
      t.type,
      sql`coalesce(${t.storeId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`coalesce(${t.productId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.sessionId,
    ),
    index("analytics_daily_sessions_day_idx").on(t.day),
  ],
);
