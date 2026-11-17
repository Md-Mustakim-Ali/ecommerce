import type { PaymentEventData, WebhookEvent } from "@jomma/sdk";
import { SignatureVerificationError } from "@jomma/sdk";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jommaWebhookEvents, orders } from "@/lib/db/schema";
import { sendOrderConfirmation } from "@/lib/email/notify";
import { recordOrderPaid, recordOrderReversed } from "@/lib/money/ledger";
import { jomma, jommaWebhookSecret } from "@/lib/payments/jomma/client";
import { coverageForOrder } from "@/lib/payments/jomma/coverage";
import { releaseOrderStock } from "@/lib/payments/jomma/release";
import { fetchAndPersistAppliedPayments } from "@/lib/payments/jomma/sync";

/**
 * Jomma's webhook.
 *
 * This endpoint is the only thing in the application allowed to decide that an
 * order has been paid. The buyer landing on `returnUrl` proves nothing — it is
 * a plain GET that anybody can type into a browser, and treating it as payment
 * is a free-goods hole. That page says "thanks, checking"; this route changes
 * state.
 *
 * Three invariants, in the order they are enforced:
 *
 *   1. The signature is verified before the body is parsed. Not after, not
 *      conditionally, and not skipped in development — an unverified
 *      `payment.succeeded` is an unauthenticated instruction to ship goods.
 *   2. The raw bytes go to `constructEvent` untouched. A signature covers the
 *      exact bytes that were sent, so parsing and re-serialising would reorder
 *      keys, change whitespace, and fail every time.
 *   3. Every event is recorded by `event.id` before it is acted on, and a
 *      duplicate id is a no-op. Delivery is at-least-once; two deliveries of
 *      one `payment.succeeded` must not ship twice or count revenue twice.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Node, not Edge: the ledger writes run through the Postgres driver. */
export const runtime = "nodejs";
/** Never cached, never statically analysed into a build-time fetch. */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // Raw, before anything else touches it.
  const raw = await request.text();

  let event: WebhookEvent<PaymentEventData>;
  try {
    event = jomma().webhooks.construct(
      raw,
      request.headers.get("x-jomma-signature"),
      jommaWebhookSecret(),
    );
  } catch (error) {
    if (error instanceof SignatureVerificationError) {
      // No detail in the response. Distinguishing "bad signature" from "stale
      // timestamp" for an unauthenticated caller builds them an oracle.
      return new Response("bad signature", { status: 400 });
    }
    // A missing JOMMA_WEBHOOK_SECRET lands here, and it is ours, not theirs.
    // 500 so Jomma retries once we have fixed the configuration.
    console.error("[jomma] webhook construction failed", error);
    return new Response("webhook not configured", { status: 500 });
  }

  // ── Idempotency ────────────────────────────────────────────────────────
  //
  // Claim the event id first. The insert either wins or finds the row already
  // there, and only the winner proceeds — so a redelivery, or two deliveries
  // racing on separate instances, cannot both run the handler.
  const claimed = await db
    .insert(jommaWebhookEvents)
    .values({
      id: event.id,
      type: event.type,
      intentId: event.data?.intent_id ?? null,
      clientReference: event.data?.client_reference ?? null,
      payload: event,
    })
    .onConflictDoNothing({ target: jommaWebhookEvents.id })
    .returning({ id: jommaWebhookEvents.id });

  if (claimed.length === 0) {
    // Already seen. 200 so Jomma stops retrying.
    return Response.json({ received: true, duplicate: true });
  }

  try {
    const handled = await handle(event);
    await db
      .update(jommaWebhookEvents)
      .set({ handledAt: new Date() })
      .where(eq(jommaWebhookEvents.id, event.id));
    return Response.json({ received: true, ...handled });
  } catch (error) {
    // The row stays with a null handled_at, which is the query that finds
    // events we accepted and then dropped. Deleting the claim instead would
    // let a retry through, but a handler that failed halfway is exactly the
    // case where re-running it blindly is unsafe.
    console.error("[jomma] handler failed", { eventId: event.id, error });
    return new Response("handler error", { status: 500 });
  }
}

async function handle(
  event: WebhookEvent<PaymentEventData>,
): Promise<{ handled: boolean; reason?: string }> {
  // account.* carry a different payload shape entirely — reading intent_id or
  // amount off one would produce undefined, not an error. They are operational
  // signals about a receiving phone, never order state.
  if (event.type === "account.degraded" || event.type === "account.recovered") {
    console.warn(`[jomma] ${event.type}`, event.data);
    return { handled: true, reason: "account event logged" };
  }

  const order = await findOrder(event.data);
  if (!order) {
    // Acknowledge rather than 404. Retrying an order we do not have will never
    // resolve itself, and the event row is already stored for investigation.
    return { handled: false, reason: "no matching order" };
  }

  /*
    Pull the transfers behind this event before acting on it.

    The event itself carries a single `trx_id`, which on a split payment is only
    whichever transfer happened to complete the intent — the earlier ones are not
    in the payload at all. `Intent.payments[]` has all of them, so the record of
    what the buyer actually sent has to come from a fetch, not from the event.

    Best-effort on purpose: this must never turn a payment we have been told
    about into a 500 and a retry loop. Losing the breakdown is recoverable — the
    order page's poll fetches it again — whereas failing to fulfil an order that
    Jomma has confirmed is not.
  */
  if (event.data.intent_id) {
    try {
      await fetchAndPersistAppliedPayments(order.id, event.data.intent_id);
    } catch (error) {
      console.error("[jomma] could not store applied payments", {
        orderId: order.id,
        intentId: event.data.intent_id,
        error,
      });
    }
  }

  switch (event.type) {
    case "payment.succeeded": {
      /*
        Asked of the order, not of this event.

        This used to require `received_amount === order.totalCents`, which was
        right while an order had exactly one intent for its full price. It stops
        being right the moment a buyer can come back and finish paying: an
        order that expired half-paid gets a new intent for the balance, so the
        event that completes it reports the balance and not the total, and the
        equality check refused to settle an order that was fully paid.

        The guard it was providing has not been dropped, only moved. What it
        caught was our own amount handling being wrong — that now lives in the
        resume path, which raises an intent for exactly what coverage says is
        outstanding, and in the overpaid warning below.
      */
      const coverage = await coverageForOrder(order.id);
      if (!coverage.covered) {
        console.error("[jomma] succeeded but order is not covered", {
          orderId: order.id,
          total: coverage.totalCents,
          received: coverage.receivedCents,
          outstanding: coverage.outstandingCents,
        });
        return { handled: false, reason: "not covered" };
      }

      const result = await recordOrderPaid(db, {
        orderId: order.id,
        paymentIntentId: event.data.intent_id,
      });

      // Only on the call that actually recorded it, so a redelivery that slips
      // past the event claim still cannot send a second receipt.
      if (result.recorded) await sendOrderConfirmation(order.id);

      return { handled: result.recorded };
    }

    case "payment.partial": {
      // Explicitly NOT fulfilled. The buyer still owes `shortfall`, and the
      // hosted pay page is where they top it up — the intent stays open, so a
      // later Send Money for the balance produces payment.succeeded.
      console.warn("[jomma] partial payment", {
        orderId: order.id,
        shortfall: event.data.shortfall,
        received: event.data.received_amount,
      });
      return { handled: true, reason: "awaiting balance" };
    }

    case "payment.overpaid": {
      // Fulfil — they have paid at least what was asked. The excess is a real
      // debt to the buyer, so it is recorded loudly rather than pocketed.
      const result = await recordOrderPaid(db, {
        orderId: order.id,
        paymentIntentId: event.data.intent_id,
      });
      if (result.recorded) await sendOrderConfirmation(order.id);

      console.warn("[jomma] OVERPAID — refund owed to buyer", {
        orderId: order.id,
        orderNumber: order.orderNumber,
        excess: event.data.excess,
        trxId: event.data.trx_id,
        senderMsisdn: event.data.sender_msisdn,
      });
      return { handled: result.recorded, reason: "overpaid, refund owed" };
    }

    case "payment.expired": {
      /*
        An expired intent no longer ends the order.

        It used to release the stock here and be done. That was right while a
        buyer had exactly one chance to pay: fifteen minutes, then the order is
        gone. It is wrong now that they can come back — an intent expiring is a
        payment window closing, not a buyer giving up, and someone who reads
        their email an hour later must still find their order where they left
        it.

        So this records the fact and changes nothing. Expiry is now decided in
        exactly one place, by the sweep in lib/orders/confirmation.ts, which
        gives an unpaid order a full day and then takes the stock back. Two
        things racing to decide when an order dies is how one of them starts
        killing orders somebody has already paid for.
      */
      if (order.status !== "pending") {
        return { handled: false, reason: `order is ${order.status}` };
      }
      console.info("[jomma] intent expired, order still resumable", {
        orderId: order.id,
        orderNumber: order.orderNumber,
        intentId: event.data.intent_id,
      });
      return { handled: true, reason: "resumable until the sweep" };
    }

    case "payment.cancelled": {
      if (order.status !== "pending") {
        return { handled: false, reason: `order is ${order.status}` };
      }
      await releaseOrderStock(order.id, "cancelled");
      return { handled: true };
    }

    case "payment.reversed": {
      // Jomma told us money arrived and has now withdrawn that. Un-fulfil:
      // negative ledger entries that cancel the sale and its commission, and
      // the order moves to payment_reversed — which is not `refunded`, because
      // nobody gave anything back.
      const result = await recordOrderReversed(db, {
        orderId: order.id,
        reason: event.data.reason ?? "match withdrawn by Jomma",
        eventId: event.id,
      });

      console.error("[jomma] PAYMENT REVERSED", {
        orderId: order.id,
        orderNumber: order.orderNumber,
        trxId: event.data.trx_id,
        unwound: result.recorded,
      });
      return { handled: result.recorded, reason: "payment reversed" };
    }

    default: {
      // A Jomma upgrade adding an event type reaches here. 200, because a
      // retry loop over something this version will never understand cannot
      // resolve itself — and the row is already stored to be looked at.
      const unknown: string = event.type;
      return { handled: false, reason: `unhandled type ${unknown}` };
    }
  }
}

/**
 * Finds the order an event belongs to.
 *
 * `client_reference` is our own order id and is the primary key of the match.
 * `payment_intent_id` is the fallback for an intent created before the
 * reference was stored, and for events replayed from Jomma's side after an
 * order row was rewritten.
 */
async function findOrder(data: PaymentEventData) {
  const columns = {
    id: orders.id,
    status: orders.status,
    totalCents: orders.totalCents,
    orderNumber: orders.orderNumber,
  };

  // Shape-checked before it reaches the query. orders.id is a uuid column, so
  // comparing it to a non-uuid string is a Postgres cast error, not a miss —
  // an intent created by hand with a client_reference of "test" would 500 this
  // endpoint and put Jomma into a retry loop instead of returning "no matching
  // order".
  if (data.client_reference && UUID.test(data.client_reference)) {
    const [byReference] = await db
      .select(columns)
      .from(orders)
      .where(eq(orders.id, data.client_reference))
      .limit(1);
    if (byReference) return byReference;
  }

  if (data.intent_id) {
    const [byIntent] = await db
      .select(columns)
      .from(orders)
      .where(eq(orders.paymentIntentId, data.intent_id))
      .limit(1);
    if (byIntent) return byIntent;
  }

  return null;
}
