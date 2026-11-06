import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { timestamps } from "./_shared";

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
