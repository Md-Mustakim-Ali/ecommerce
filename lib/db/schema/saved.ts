import { relations } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { primaryId } from "./_shared";
import { user } from "./auth";
import { products } from "./catalog";

/**
 * Saved items, i.e. the wishlist.
 *
 * Keyed on product rather than variant: a shopper saves "that jacket", not
 * "that jacket in medium navy". The variant is chosen on the product page.
 *
 * Signed-in only. A guest wishlist would need its own cookie-scoped table and
 * a merge on sign-in, which is not worth it until somebody asks.
 */
export const savedItems = pgTable(
  "saved_items",
  {
    id: primaryId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("saved_items_user_product_key").on(t.userId, t.productId),
    index("saved_items_user_idx").on(t.userId, t.createdAt),
  ],
);

export const savedItemsRelations = relations(savedItems, ({ one }) => ({
  user: one(user, { fields: [savedItems.userId], references: [user.id] }),
  product: one(products, {
    fields: [savedItems.productId],
    references: [products.id],
  }),
}));
