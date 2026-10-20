import { relations } from "drizzle-orm";
import { boolean, index, pgTable, text } from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared";
import { user } from "./auth";

/**
 * Saved addresses are a convenience for filling in checkout, nothing more.
 *
 * They are versioned by copy, not by reference: placing an order snapshots the
 * address onto `orders.shipping_address`. Editing or deleting a saved address
 * must never change what a past order says it shipped to.
 *
 * Note there is no `user_roles` table. docs/schema.md proposed one with
 * buyer/seller/admin, but roles are now handled properly in rbac.ts — "seller"
 * is derivable from owning a store or holding a store membership, and "admin"
 * from holding any platform role. A second, coarser source of truth for the
 * same question would only drift.
 */
export const addresses = pgTable(
  "addresses",
  {
    id: primaryId(),

    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    label: text("label"),
    recipientName: text("recipient_name").notNull(),
    phone: text("phone"),

    line1: text("line1").notNull(),
    line2: text("line2"),
    city: text("city").notNull(),
    region: text("region"),
    postalCode: text("postal_code").notNull(),
    countryCode: text("country_code").notNull(),

    isDefaultShipping: boolean("is_default_shipping").notNull().default(false),
    isDefaultBilling: boolean("is_default_billing").notNull().default(false),

    ...timestamps,
  },
  (t) => [index("addresses_user_idx").on(t.userId)],
);

export const addressesRelations = relations(addresses, ({ one }) => ({
  user: one(user, { fields: [addresses.userId], references: [user.id] }),
}));
