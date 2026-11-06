import { relations, sql } from "drizzle-orm";
import {
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
import { productVariants } from "./catalog";
import { stores } from "./stores";

export const orderStatus = pgEnum("order_status", [
  "pending",
  "paid",
  "partially_fulfilled",
  "fulfilled",
  "cancelled",
  "refunded",
  /**
   * A confirmed payment was later un-matched by the payment verifier.
   *
   * Distinct from `refunded`, and the distinction is not pedantry. A refund
   * means the buyer had the goods and we gave the money back; a reversal means
   * the money was never really there — Jomma matched an incoming Send Money
   * message to this order and subsequently withdrew that match. Collapsing the
   * two would tell a seller they refunded a customer they never got paid by,
   * and would put a fictional refund in the platform's revenue reporting.
   *
   * Only reachable from the reversal path in lib/money/ledger.ts, which also
   * writes the negative ledger entries that unwind the sale and its
   * commission.
   */
  "payment_reversed",
]);

export const subOrderStatus = pgEnum("sub_order_status", [
  "pending",
  "accepted",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
]);

/** A shipping or billing address, copied at purchase time. Never a reference. */
export type AddressSnapshot = {
  recipientName: string;
  phone?: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode: string;
  countryCode: string;
};

/**
 * The buyer's view. One order, one payment.
 *
 * A cart holding items from three sellers becomes one `orders` row and three
 * `sub_orders` rows. This split cannot be retrofitted cheaply, which is why it
 * exists from the first migration rather than when the second seller signs up.
 */
export const orders = pgTable(
  "orders",
  {
    id: primaryId(),

    buyerId: text("buyer_id").references(() => user.id, {
      onDelete: "set null",
    }),

    /** Human-readable, e.g. ORD-2026-000123. Shown to buyers and support. */
    orderNumber: text("order_number").notNull(),

    /** Guest checkout is allowed, so contact details live on the order. */
    email: text("email").notNull(),

    status: orderStatus("status").notNull().default("pending"),

    subtotalCents: integer("subtotal_cents").notNull(),
    shippingCents: integer("shipping_cents").notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    discountCents: integer("discount_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    currency: text("currency").notNull(),

    // SNAPSHOTS. Editing a saved address must never change what a past order
    // says it shipped to.
    shippingAddress: jsonb("shipping_address")
      .$type<AddressSnapshot>()
      .notNull(),
    billingAddress: jsonb("billing_address").$type<AddressSnapshot>(),

    paymentIntentId: text("payment_intent_id"),

    placedAt: timestamp("placed_at", { withTimezone: true }),

    ...timestamps,
  },
  (t) => [
    uniqueIndex("orders_number_key").on(t.orderNumber),
    index("orders_buyer_idx").on(t.buyerId),
    index("orders_status_idx").on(t.status),
    index("orders_email_idx").on(t.email),
  ],
);

/** One per store. The seller's view, and the unit that gets paid out. */
export const subOrders = pgTable(
  "sub_orders",
  {
    id: primaryId(),

    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),

    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),

    status: subOrderStatus("status").notNull().default("pending"),

    subtotalCents: integer("subtotal_cents").notNull(),
    shippingCents: integer("shipping_cents").notNull().default(0),
    commissionCents: integer("commission_cents").notNull().default(0),
    payoutCents: integer("payout_cents").notNull().default(0),

    trackingCarrier: text("tracking_carrier"),
    trackingNumber: text("tracking_number"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),

    ...timestamps,
  },
  (t) => [
    index("sub_orders_store_status_idx").on(t.storeId, t.status),
    index("sub_orders_order_idx").on(t.orderId),
  ],
);

/**
 * Everything here except `variantId` is a snapshot taken at purchase time and
 * never updated. If a seller renames a product, changes its price, or deletes
 * it outright, the order still renders exactly as the buyer saw it.
 *
 * Order displays must never join to the live product price.
 */
export const orderItems = pgTable(
  "order_items",
  {
    id: primaryId(),

    subOrderId: uuid("sub_order_id")
      .notNull()
      .references(() => subOrders.id, { onDelete: "cascade" }),

    /** Reference for support lookups only. Never read for display or price. */
    variantId: uuid("variant_id").references(() => productVariants.id, {
      onDelete: "set null",
    }),

    // SNAPSHOTS
    productTitle: text("product_title").notNull(),
    variantLabel: text("variant_label"),
    sku: text("sku"),
    imageUrl: text("image_url"),
    unitPriceCents: integer("unit_price_cents").notNull(),

    quantity: integer("quantity").notNull(),
    lineTotalCents: integer("line_total_cents").notNull(),

    ...timestamps,
  },
  (t) => [
    index("order_items_sub_order_idx").on(t.subOrderId),
    index("order_items_variant_idx").on(t.variantId),
  ],
);

/**
 * Who wrote it. `staff` covers the seller's team and platform support alike —
 * from the buyer's side they are the same voice, and the audit log already
 * records exactly which account it was.
 */
export const orderNoteAuthor = pgEnum("order_note_author", ["staff", "buyer"]);

/**
 * `internal` is never sent anywhere and never rendered outside the dashboard.
 * `buyer` appears on the buyer's own order page.
 */
export const orderNoteVisibility = pgEnum("order_note_visibility", [
  "internal",
  "buyer",
]);

/**
 * Notes and messages on a sub-order.
 *
 * One table, two permissions: `order.note` writes an internal note and
 * `customer.contact` writes one the buyer can read. They are the same act with
 * a different audience, and splitting them into two tables would mean two
 * queries and two components to render one conversation in date order.
 *
 * Attached to the sub-order rather than the order. A cart split across three
 * sellers must not let one of them read what another wrote about the buyer,
 * and scoping by sub-order makes that structural rather than a WHERE clause
 * somebody has to remember.
 *
 * The buyer replies here too, which is all "message a buyer" needs to mean in
 * a marketplace: a thread hanging off the thing being discussed, where both
 * sides already have context. A general inbox would be a bigger surface with
 * worse defaults — no order attached, and a spam problem on day one.
 */
export const orderNotes = pgTable(
  "order_notes",
  {
    id: primaryId(),

    subOrderId: uuid("sub_order_id")
      .notNull()
      .references(() => subOrders.id, { onDelete: "cascade" }),

    authorRole: orderNoteAuthor("author_role").notNull(),
    visibility: orderNoteVisibility("visibility").notNull(),

    authorId: text("author_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /**
     * Snapshotted, like everything else on an order. A note that reads "deleted
     * user said the buyer was abusive" is worth less than nothing.
     */
    authorName: text("author_name").notNull(),

    body: text("body").notNull(),

    /** When the other side last opened the thread. Null while unread. */
    readAt: timestamp("read_at", { withTimezone: true }),

    ...timestamps,
  },
  (t) => [
    index("order_notes_sub_order_idx").on(t.subOrderId, t.createdAt),
    // The buyer's order page reads only the visible half, on every render.
    index("order_notes_visible_idx")
      .on(t.subOrderId, t.createdAt)
      .where(sql`${t.visibility} = 'buyer'`),
  ],
);

export const ordersRelations = relations(orders, ({ one, many }) => ({
  buyer: one(user, { fields: [orders.buyerId], references: [user.id] }),
  subOrders: many(subOrders),
}));

export const subOrdersRelations = relations(subOrders, ({ one, many }) => ({
  order: one(orders, { fields: [subOrders.orderId], references: [orders.id] }),
  store: one(stores, { fields: [subOrders.storeId], references: [stores.id] }),
  items: many(orderItems),
  notes: many(orderNotes),
}));

export const orderNotesRelations = relations(orderNotes, ({ one }) => ({
  subOrder: one(subOrders, {
    fields: [orderNotes.subOrderId],
    references: [subOrders.id],
  }),
  author: one(user, { fields: [orderNotes.authorId], references: [user.id] }),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  subOrder: one(subOrders, {
    fields: [orderItems.subOrderId],
    references: [subOrders.id],
  }),
}));
