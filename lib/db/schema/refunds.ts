import { relations } from "drizzle-orm";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared";
import { user } from "./auth";
import { subOrders } from "./orders";
import { stores } from "./stores";

export const refundStatus = pgEnum("refund_status", [
  /** Asked for by the seller, waiting on the platform. */
  "requested",
  /** Approved and written to the ledger. */
  "approved",
  "rejected",
]);

/**
 * A refund request, separate from the ledger entry it eventually produces.
 *
 * Two reasons for the split. A seller can ask for a refund but not move money
 * — `order.refund` and `platform.refund.approve` are deliberately different
 * permissions — so the request has to exist in a state where nothing has
 * happened yet. And a rejected request is worth keeping: "why was my customer
 * not refunded" is unanswerable if a refusal leaves no trace.
 */
export const refundRequests = pgTable(
  "refund_requests",
  {
    id: primaryId(),

    subOrderId: uuid("sub_order_id")
      .notNull()
      .references(() => subOrders.id, { onDelete: "cascade" }),

    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),

    /** Minor units. May be less than the sub-order for a partial refund. */
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),

    reason: text("reason").notNull(),
    status: refundStatus("status").notNull().default("requested"),

    requestedBy: text("requested_by").references(() => user.id, {
      onDelete: "set null",
    }),
    reviewedBy: text("reviewed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    reviewNote: text("review_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),

    ...timestamps,
  },
  (t) => [
    index("refund_requests_status_idx").on(t.status),
    index("refund_requests_store_idx").on(t.storeId),
    index("refund_requests_sub_order_idx").on(t.subOrderId),
  ],
);

export const refundRequestsRelations = relations(refundRequests, ({ one }) => ({
  subOrder: one(subOrders, {
    fields: [refundRequests.subOrderId],
    references: [subOrders.id],
  }),
  store: one(stores, {
    fields: [refundRequests.storeId],
    references: [stores.id],
  }),
}));
