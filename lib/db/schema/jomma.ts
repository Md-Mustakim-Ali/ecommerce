import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared";
import { orders } from "./orders";

/**
 * Every webhook Jomma has ever delivered to us.
 *
 * ── Why this table exists ────────────────────────────────────────────────
 *
 * Delivery is at-least-once with retries, and the handler must be idempotent
 * on `event.id`. Nothing else in the schema could carry that. The existing
 * guards are close but not equivalent:
 *
 *   - `orders.status !== 'pending'` stops a second `payment.succeeded` from
 *     crediting twice, but says nothing about a redelivered `payment.partial`,
 *     and would happily let a `payment.expired` arriving after a success run
 *     its release-stock branch.
 *   - `ledger_entries.idempotency_key` is keyed on the sub-order, so it
 *     deduplicates the *effect* of a payment, not the *delivery* of an event.
 *
 * Keying on the event id makes a replay a no-op for every event type,
 * including the ones that write nothing to the ledger.
 *
 * ── Why the whole payload is kept ────────────────────────────────────────
 *
 * Jomma is the only witness to a payment. It watches a phone for Send Money
 * messages; there is no card network to re-query and no statement to reconcile
 * against. If a buyer disputes an order, the signed event that caused us to
 * ship it — with its trx_id, sender number and match confidence — is the
 * entire evidence trail. It is small, and losing it is unrecoverable.
 */
export const jommaWebhookEvents = pgTable(
  "jomma_webhook_events",
  {
    /**
     * Jomma's `event.id`, used directly as the primary key rather than as a
     * unique column beside a surrogate. The uniqueness *is* the point of the
     * row, and an insert conflict on the primary key is what makes the handler
     * idempotent.
     */
    id: text("id").primaryKey(),

    /** `payment.succeeded`, `account.degraded`, … Stored as text so a new event
     * type from a Jomma upgrade lands in the table instead of failing the
     * insert and forcing an endless retry loop. */
    type: text("type").notNull(),

    /** Null for account.* events, which carry no intent. */
    intentId: text("intent_id"),

    /** Our order id, as sent in `clientReference`. Null on account.* events. */
    clientReference: text("client_reference"),

    /** The verified event, exactly as parsed. */
    payload: jsonb("payload").notNull(),

    /**
     * Set once the handler has finished acting on it.
     *
     * Separate from `created_at` so a crash between "recorded the event" and
     * "acted on it" is visible rather than silently swallowed — a row with a
     * null `handled_at` is an event we accepted and then dropped.
     */
    handledAt: timestamp("handled_at", { withTimezone: true }),

    ...timestamps,
  },
  (t) => [
    index("jomma_events_intent_idx").on(t.intentId),
    index("jomma_events_reference_idx").on(t.clientReference),
    // Finds events accepted but never acted on. Small and partial.
    index("jomma_events_unhandled_idx")
      .on(t.createdAt)
      .where(sql`${t.handledAt} is null`),
  ],
);

/**
 * The individual Send Money transfers Jomma applied to an order.
 *
 * ── Why a table and not a column ─────────────────────────────────────────
 *
 * One order does not mean one transfer. A buyer who sends ৳400 against a ৳900
 * order and tops up the balance later produces *two* transfers with two
 * separate TrxIDs, possibly from two different handsets, and Jomma applies both
 * to the same intent. `Intent.payments[]` is an array for exactly that reason,
 * so anything storing a single `trx_id` on `orders` would silently keep one and
 * lose the other — and the one it lost is the one the buyer rings up about.
 *
 * ── Why it is stored at all ──────────────────────────────────────────────
 *
 * It was not, before this table. The webhook logged `trx_id` and
 * `sender_msisdn` to the console for two of the six event types and discarded
 * them everywhere else, leaving the raw event JSON in `jomma_webhook_events` as
 * the only copy. That is an audit record, not a queryable one: no page could
 * show a buyer which transfer paid their order, and no support conversation
 * could start from a TrxID.
 *
 * Rows come from `Intent.payments[]` via `intents.get()`, never from the
 * webhook payload alone — a `payment.succeeded` event carries one `trx_id`,
 * which on a split payment is only the transfer that happened to complete it.
 */
export const jommaAppliedPayments = pgTable(
  "jomma_applied_payments",
  {
    id: primaryId(),

    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),

    /** The intent these were applied to. Kept for reconciliation by intent. */
    intentId: text("intent_id").notNull(),

    /**
     * bKash's or Nagad's own transaction id, as it appears in the buyer's SMS.
     *
     * Nullable because Jomma's type is: an admin resolving a payment by hand
     * may have no TrxID to record. It is still the first thing support asks
     * for, which is why it is indexed.
     */
    trxId: text("trx_id"),

    /** The number the money actually came from — not necessarily the buyer's. */
    senderMsisdn: text("sender_msisdn"),

    /** Poisha, matching every other money column in the schema. */
    amountCents: integer("amount_cents").notNull(),

    /** When the transfer happened, per the provider. Null when unknown. */
    occurredAt: timestamp("occurred_at", { withTimezone: true }),

    /** When Jomma applied it to the intent. Always present. */
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull(),

    /** `exact` | `fuzzy` | `sender` | `lock` | `manual`. Text, so a new Jomma
     * confidence level lands in the row rather than failing the insert. */
    matchConfidence: text("match_confidence").notNull(),

    /** `automatic` | `submission` | `admin`. */
    matchedBy: text("matched_by").notNull(),

    ...timestamps,
  },
  (t) => [
    index("jomma_payments_order_idx").on(t.orderId),
    index("jomma_payments_trx_idx").on(t.trxId),
    /*
      Makes re-syncing an intent idempotent.

      The `coalesce` is load-bearing, not a stylistic choice: trx_id is nullable
      and Postgres treats NULLs as distinct, so a plain unique index over it
      would not collide at all. Every poll of an intent holding a
      manually-matched payment would then insert another copy, and a buyer
      sitting on the order page would watch their payment list grow every three
      seconds. `nulls not distinct` would say this more directly, but
      drizzle-orm 0.45's index builder does not expose it.

      applied_at is in the key because it is what separates two genuinely
      different transfers that both lack a TrxID. Jomma sets it once, when it
      applies the payment, so it is stable across polls.
    */
    uniqueIndex("jomma_payments_unique_idx").on(
      t.intentId,
      sql`coalesce(${t.trxId}, '')`,
      t.appliedAt,
    ),
  ],
);
