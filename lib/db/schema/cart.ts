import { relations } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared";
import { user } from "./auth";
import { productVariants } from "./catalog";

/**
 * One cart per user, or per guest session token.
 *
 * Deliberately no price column. Price is resolved live at render and again at
 * checkout, so a price change is reflected immediately rather than a stale cart
 * quietly promising an old price. The snapshot happens at purchase time, on
 * the order item, and nowhere earlier.
 */
export const carts = pgTable(
  "carts",
  {
    id: primaryId(),

    /** Null for guests, who are identified by sessionToken instead. */
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    sessionToken: text("session_token"),

    ...timestamps,
  },
  (t) => [
    uniqueIndex("carts_user_key").on(t.userId),
    uniqueIndex("carts_session_key").on(t.sessionToken),
  ],
);

export const cartItems = pgTable(
  "cart_items",
  {
    id: primaryId(),

    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),

    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),

    quantity: integer("quantity").notNull().default(1),

    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Adding the same variant twice increments quantity rather than creating a
    // second row.
    uniqueIndex("cart_items_cart_variant_key").on(t.cartId, t.variantId),
    index("cart_items_cart_idx").on(t.cartId),
  ],
);

export const cartsRelations = relations(carts, ({ one, many }) => ({
  user: one(user, { fields: [carts.userId], references: [user.id] }),
  items: many(cartItems),
}));

export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  cart: one(carts, { fields: [cartItems.cartId], references: [carts.id] }),
  variant: one(productVariants, {
    fields: [cartItems.variantId],
    references: [productVariants.id],
  }),
}));
