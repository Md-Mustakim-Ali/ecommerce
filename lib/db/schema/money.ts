import { relations } from "drizzle-orm";
import {
  bigint,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared";
import { subOrders } from "./orders";
import { stores } from "./stores";

export const ledgerEntryType = pgEnum("ledger_entry_type", [
  "sale",
  "commission",
  "refund",
  "adjustment",
  "payout",
  "fee",
]);

export const payoutStatus = pgEnum("payout_status", [
  "pending",
  "processing",
  "paid",
  "failed",
]);

/**
 * Append-only. There is no mutable balance column anywhere in this schema.
 *
 *   select coalesce(sum(amount_cents), 0)
 *   from ledger_entries
 *   where store_id = $1 and currency = $2;
 *
 * Rules that follow, and that a database trigger enforces rather than
 * discipline (see the migration):
 *
 *   - no UPDATE and no DELETE on this table, ever
 *   - a refund is a new negative entry, not an edit to the sale entry
 *   - a payout writes a negative entry; it never rewrites history
 *   - reconciliation is a query, not a stored value
 *
 * When a payout goes wrong six months from now, and one will, this is the only
 * thing that can say what actually happened.
 */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: primaryId(),

    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),

    /** Null for adjustments and fees that are not tied to an order. */
    subOrderId: uuid("sub_order_id").references(() => subOrders.id, {
      onDelete: "restrict",
    }),

    type: ledgerEntryType("type").notNull(),

    /**
     * Signed. Credits positive, debits negative. bigint because a lifetime sum
     * of paisa or cents for a large store will outgrow a 32-bit integer.
     */
    amountCents: bigint("amount_cents", { mode: "bigint" }).notNull(),

    currency: text("currency").notNull(),
    description: text("description"),

    /**
     * Deduplicates writes driven by payment webhooks, which are delivered at
     * least once and therefore arrive twice sooner or later.
     */
    idempotencyKey: text("idempotency_key"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("ledger_entries_store_created_idx").on(t.storeId, t.createdAt),
    index("ledger_entries_sub_order_idx").on(t.subOrderId),
    uniqueIndex("ledger_entries_idempotency_key").on(t.idempotencyKey),
  ],
);

export const payouts = pgTable(
  "payouts",
  {
    id: primaryId(),

    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),

    amountCents: bigint("amount_cents", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),

    status: payoutStatus("status").notNull().default("pending"),
    providerTransferId: text("provider_transfer_id"),
    failureReason: text("failure_reason"),

    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),

    initiatedAt: timestamp("initiated_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    ...timestamps,
  },
  (t) => [
    index("payouts_store_status_idx").on(t.storeId, t.status),
    index("payouts_status_idx").on(t.status),
  ],
);

export const ledgerEntriesRelations = relations(ledgerEntries, ({ one }) => ({
  store: one(stores, {
    fields: [ledgerEntries.storeId],
    references: [stores.id],
  }),
  subOrder: one(subOrders, {
    fields: [ledgerEntries.subOrderId],
    references: [subOrders.id],
  }),
}));

export const payoutsRelations = relations(payouts, ({ one }) => ({
  store: one(stores, { fields: [payouts.storeId], references: [stores.id] }),
}));
