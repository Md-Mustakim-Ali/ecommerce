import { relations } from "drizzle-orm";
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

export const ordersRelations = relations(orders, ({ one, many }) => ({
  buyer: one(user, { fields: [orders.buyerId], references: [user.id] }),
  subOrders: many(subOrders),
}));

export const subOrdersRelations = relations(subOrders, ({ one, many }) => ({
  order: one(orders, { fields: [subOrders.orderId], references: [orders.id] }),
  store: one(stores, { fields: [subOrders.storeId], references: [stores.id] }),
  items: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  subOrder: one(subOrders, {
    fields: [orderItems.subOrderId],
    references: [subOrders.id],
  }),
}));
