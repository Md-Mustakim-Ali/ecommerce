import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { sendOrderConfirmation } from "@/lib/email/notify";
import { recordOrderPaid } from "@/lib/money/ledger";
import { paymentProvider } from "@/lib/payments";

/**
 * Payment webhook.
 *
 * The signature is verified before anything else happens. An unverified
 * webhook is an unauthenticated request that marks orders paid and credits
 * seller balances — the single most valuable endpoint to forge on the whole
 * site.
 *
 * The raw body is read as text and passed through untouched, because a
 * signature covers the exact bytes sent. Parsing first and re-serialising
 * would change them and every signature would fail.
 *
 * Delivery is at-least-once, so this must be idempotent. The order status
 * check plus the unique index on ledger_entries.idempotency_key mean a
 * redelivered event is a no-op rather than a double credit.
 */
export async function POST(request: Request) {
  const provider = paymentProvider();

  const payload = await request.text();
  const signature =
    request.headers.get("x-signature") ??
    request.headers.get("stripe-signature");

  let event: Awaited<ReturnType<typeof provider.parseWebhook>>;
  try {
    event = await provider.parseWebhook({ payload, signature });
  } catch {
    // Never echo the failure reason. A verification oracle helps only an
    // attacker.
    return new Response("invalid", { status: 400 });
  }

  if (event.type === "ignored") {
    // 200 so the provider stops retrying something we will never handle.
    return Response.json({ received: true, handled: false });
  }

  const [order] = await db
    .select({
      id: orders.id,
      status: orders.status,
      totalCents: orders.totalCents,
    })
    .from(orders)
    .where(eq(orders.paymentIntentId, event.intentId))
    .limit(1);

  if (!order) {
    // Acknowledge rather than 404. A retry loop over an order we do not have
    // will never resolve itself.
    return Response.json({ received: true, handled: false });
  }

  switch (event.type) {
    case "payment.succeeded": {
      // The provider is the authority on what was actually charged. If it
      // disagrees with the order, something is wrong enough to stop.
      if (event.amountCents !== order.totalCents) {
        return Response.json(
          { received: true, handled: false, reason: "amount mismatch" },
          { status: 409 },
        );
      }

      const result = await recordOrderPaid(db, {
        orderId: order.id,
        paymentIntentId: event.intentId,
      });

      // Only on the call that recorded it. Providers retry webhooks freely,
      // and recordOrderPaid is idempotent precisely so a retry is harmless —
      // mailing a receipt unconditionally would undo that.
      if (result.recorded) {
        await sendOrderConfirmation(order.id);
      }

      return Response.json({
        received: true,
        handled: result.recorded,
        entries: result.entries,
      });
    }

    case "payment.failed": {
      // Only from pending. A paid order that later reports a failure needs a
      // human, not an automatic downgrade.
      if (order.status === "pending") {
        await db
          .update(orders)
          .set({ status: "cancelled" })
          .where(eq(orders.id, order.id));
      }
      return Response.json({ received: true, handled: true });
    }

    case "refund.succeeded":
      // Refunds are initiated from the admin panel, which writes the ledger
      // entries itself. Acknowledged here so the provider stops retrying.
      return Response.json({ received: true, handled: true });

    default:
      return Response.json({ received: true, handled: false });
  }
}
