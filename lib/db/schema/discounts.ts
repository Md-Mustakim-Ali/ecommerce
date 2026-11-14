import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared";
import { user } from "./auth";
import { contentScope, contentStatus } from "./content";
import { orders } from "./orders";
import { stores } from "./stores";

export const discountKind = pgEnum("discount_kind", [
  /** A share off, held in basis points so 12.5% is exact. */
  "percentage",
  /** A flat amount off, in minor units. */
  "fixed_amount",
  /** Shipping set to zero. */
  "free_shipping",
]);

/**
 * Discount codes.
 *
 * Scoped like everything else on this platform: a platform code discounts the
 * whole order, a store code only discounts that store's lines. Without the
 * distinction a seller could publish a code that spends another seller's
 * margin, which is not a bug anyone finds until the payout run.
 *
 * `value` means different things per kind, which is normally a smell. Here the
 * alternative is three nullable columns that must be kept mutually exclusive
 * by convention, and a check constraint enforces the pairing anyway.
 */
export const discountCodes = pgTable(
  "discount_codes",
  {
    id: primaryId(),

    /**
     * Stored upper-case and matched upper-case.
     *
     * Nobody types a coupon with the capitalisation from the email, and a
     * case-sensitive code generates support tickets rather than sales.
     */
    code: text("code").notNull(),

    scope: contentScope("scope").notNull(),
    storeId: uuid("store_id").references(() => stores.id, {
      onDelete: "cascade",
    }),

    kind: discountKind("kind").notNull(),

    /** Basis points for percentage, minor units for fixed_amount, 0 otherwise. */
    value: integer("value").notNull().default(0),

    /** Caps a percentage discount, so "50% off" cannot cost more than planned. */
    maxDiscountCents: integer("max_discount_cents"),

    /** The code does not apply below this. */
    minSubtotalCents: integer("min_subtotal_cents").notNull().default(0),

    /** Null means unlimited. */
    maxRedemptions: integer("max_redemptions"),
    /**
     * Denormalised counter, incremented in the same transaction as the order.
     * Counting redemptions on demand would make every checkout scan the table.
     */
    redemptionCount: integer("redemption_count").notNull().default(0),

    /** Null means unlimited per person. */
    perCustomerLimit: integer("per_customer_limit").default(1),

    status: contentStatus("status").notNull().default("draft"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),

    description: text("description"),

    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),

    ...timestamps,
  },
  (t) => [
    // Codes are global across the marketplace. Two stores sharing "SUMMER20"
    // would make the code ambiguous at the point a buyer types it, which is
    // the one moment it has to be unambiguous.
    uniqueIndex("discount_codes_code_key").on(sql`upper(${t.code})`),
    index("discount_codes_store_idx").on(t.storeId),
    index("discount_codes_status_window_idx").on(
      t.status,
      t.startsAt,
      t.endsAt,
    ),
  ],
);

/**
 * One row per use.
 *
 * Needed for the per-customer limit, and for answering "did this campaign do
 * anything" later. The order reference makes a redemption reversible if the
 * order is cancelled.
 */
export const discountRedemptions = pgTable(
  "discount_redemptions",
  {
    id: primaryId(),

    discountId: uuid("discount_id")
      .notNull()
      .references(() => discountCodes.id, { onDelete: "cascade" }),

    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),

    /**
     * Null for a guest checkout, which a contact then identifies.
     *
     * Both contacts, mirroring `orders`, because a per-customer limit that
     * only knows about email stops counting the moment a buyer checks out with
     * a number alone — and a limit that silently stops applying is worse than
     * no limit, since the discount report still claims it held.
     */
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    email: text("email"),
    contactPhone: text("contact_phone"),

    /** What it actually took off, after caps and allocation. */
    amountCents: integer("amount_cents").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One redemption per order per code. A retried checkout must not count twice.
    uniqueIndex("discount_redemptions_order_code_key").on(
      t.orderId,
      t.discountId,
    ),
    index("discount_redemptions_discount_idx").on(t.discountId),
    index("discount_redemptions_email_idx").on(t.email),
    index("discount_redemptions_phone_idx").on(t.contactPhone),
  ],
);

export const discountCodesRelations = relations(
  discountCodes,
  ({ one, many }) => ({
    store: one(stores, {
      fields: [discountCodes.storeId],
      references: [stores.id],
    }),
    redemptions: many(discountRedemptions),
  }),
);

export const discountRedemptionsRelations = relations(
  discountRedemptions,
  ({ one }) => ({
    discount: one(discountCodes, {
      fields: [discountRedemptions.discountId],
      references: [discountCodes.id],
    }),
    order: one(orders, {
      fields: [discountRedemptions.orderId],
      references: [orders.id],
    }),
  }),
);
