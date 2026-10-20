import { relations } from "drizzle-orm";
import {
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared";
import { user } from "./auth";
import { products } from "./catalog";
import { orderItems } from "./orders";

export const reviewStatus = pgEnum("review_status", [
  "published",
  "flagged",
  "removed",
]);

/**
 * Tied to `orderItemId`, not to a product plus a user.
 *
 * That single foreign key is what makes reviews trustworthy: only somebody who
 * actually bought the item can write one, and the unique index means one
 * review per purchase rather than one per person per product.
 */
export const reviews = pgTable(
  "reviews",
  {
    id: primaryId(),

    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),

    buyerId: text("buyer_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "cascade" }),

    rating: smallint("rating").notNull(),
    title: text("title"),
    body: text("body"),

    status: reviewStatus("status").notNull().default("published"),

    ...timestamps,
  },
  (t) => [
    uniqueIndex("reviews_order_item_key").on(t.orderItemId),
    index("reviews_product_status_idx").on(t.productId, t.status),
    index("reviews_buyer_idx").on(t.buyerId),
  ],
);

export const reviewsRelations = relations(reviews, ({ one }) => ({
  product: one(products, {
    fields: [reviews.productId],
    references: [products.id],
  }),
  buyer: one(user, { fields: [reviews.buyerId], references: [user.id] }),
  orderItem: one(orderItems, {
    fields: [reviews.orderItemId],
    references: [orderItems.id],
  }),
}));
