import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { orderPath } from "@/lib/orders/access";
import { PAYMENT_WINDOW_MS } from "@/lib/orders/confirmation";
import type { PaymentMethod } from "@/lib/payments/methods";
import { normaliseBdMobile } from "@/lib/validation/phone";
import { jommaConfigured } from "./client";
import { coverageForOrder } from "./coverage";
import { startPayment } from "./intents";

/**
 * Picking up a payment that was started and not finished.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * A Jomma intent lives about fifteen minutes. A buyer who confirms their
 * email, opens the pay page and then puts their phone down has an order that
 * is real, is holding stock, and has no live way to pay for it. Before this,
 * their only route back was the pay page URL in a tab they had already closed.
 *
 * Worse is the half-paid case. Somebody sends ৳100 of ৳184 and the intent
 * expires. The order is not paid, the ৳100 is real and recorded, and the
 * obvious repair — raise the intent again — asks them for the full ৳184 a
 * second time. What they owe is ৳84, and that is the only number this may ever
 * ask for.
 *
 * ── The rule ─────────────────────────────────────────────────────────────
 *
 * Everything is decided from what the order has actually received, never from
 * the state of any one intent. See ./coverage.ts for why that distinction is
 * load-bearing.
 *
 *   covered            → nothing to do, show them the order
 *   offline (manual)   → nothing to pay online, show them the order
 *   live intent open   → send them back to the one they already have
 *   no intent, or dead → raise a new one for exactly what is outstanding
 *
 * Reusing a live intent matters more than it looks: raising a second one while
 * the first is open leaves the buyer holding two reference codes for one
 * order, and only one of them settles it.
 */

export type ResumeOutcome =
  /** Go and pay. Either the intent they already had, or a fresh one. */
  | { kind: "pay"; payUrl: string; intentId: string; amountCents: number }
  /** Nothing to pay — settled, offline, or cancelled. Show the order. */
  | {
      kind: "done";
      path: string;
      reason: "covered" | "offline" | "closed" | "window-closed";
    }
  /** We could not reach Jomma. The order is fine; the payment page is not. */
  | { kind: "unavailable"; path: string; message: string };

/**
 * What an order carries about how it should be paid.
 *
 * `paymentMethod` is null for orders placed before the column existed and for
 * any whose intent creation failed, so the intent id is the fallback — the
 * same inference the migration used to backfill.
 */
function methodOf(order: {
  paymentMethod: string | null;
  paymentIntentId: string | null;
}): PaymentMethod {
  if (order.paymentMethod) return order.paymentMethod as PaymentMethod;
  return order.paymentIntentId?.startsWith("int_") ? "any" : "manual";
}

export async function resumePayment(orderId: string): Promise<ResumeOutcome> {
  const [order] = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      totalCents: orders.totalCents,
      paymentIntentId: orders.paymentIntentId,
      paymentMethod: orders.paymentMethod,
      confirmedAt: orders.confirmedAt,
      createdAt: orders.createdAt,
      contactPhone: orders.contactPhone,
      shippingAddress: orders.shippingAddress,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!order) return { kind: "done", path: "/", reason: "closed" };

  const path = orderPath(order.id);

  /*
    Only a `pending` order has anything left to pay.

    `unconfirmed` is deliberately included in the refusal: the caller confirms
    first and then resumes, and an order still sitting unconfirmed here means
    something called this out of order. Sending that buyer to a pay page would
    let an unproven contact pay for goods, which is the whole thing the gate
    exists to stop.
  */
  if (order.status !== "pending") {
    return {
      kind: "done",
      path,
      reason: order.status === "paid" ? "covered" : "closed",
    };
  }

  // Narrowed to a value startPayment will accept, rather than checked with a
  // predicate TypeScript cannot see through.
  const method = methodOf(order);
  if (method === "manual") {
    return { kind: "done", path, reason: "offline" };
  }

  /*
    The window closes a day after they proved their contact.

    Checked here rather than left to the sweep, and the difference matters for
    the one order the sweep deliberately leaves alone: a part-paid order stays
    `pending` so the buyer can still see what they sent, and without this it
    would stay payable forever too. The status check above cannot catch that,
    because the status is exactly the one that means "payable".

    Dated from `confirmedAt`, falling back to `createdAt` for orders that were
    never gated — a null must never read as unlimited.
  */
  const windowOpenedAt = order.confirmedAt ?? order.createdAt;
  if (Date.now() - windowOpenedAt.getTime() > PAYMENT_WINDOW_MS) {
    return { kind: "done", path, reason: "window-closed" };
  }

  const coverage = await coverageForOrder(order.id);
  if (coverage.covered) {
    // Paid, but the order row has not caught up — the webhook may still be in
    // flight. Send them to the order, whose poll settles it.
    return { kind: "done", path, reason: "covered" };
  }

  if (!jommaConfigured()) {
    return {
      kind: "unavailable",
      path,
      message: "bKash and Nagad are unavailable right now.",
    };
  }

  /*
    Reuse an intent that is still alive.

    Asked of Jomma rather than assumed from our own timestamps, because Jomma
    owns the clock. Cheap: one GET, and only on a page the buyer explicitly
    asked for.
  */
  const existing = order.paymentIntentId;
  if (existing?.startsWith("int_")) {
    const live = await liveIntent(existing);
    if (live) {
      return {
        kind: "pay",
        payUrl: live.payUrl,
        intentId: existing,
        amountCents: coverage.outstandingCents,
      };
    }
  }

  /*
    Otherwise raise a new one, for the balance and never for the total.

    The idempotency key is derived from the intent being replaced rather than
    from a counter. Retrying this same repair produces the same key and so the
    same intent; a later repair, after this one has also expired, keys on a
    different id and correctly produces a new one. That removes the need to
    store an attempt number, and — more importantly — makes a double-click
    incapable of allocating a second reference code.
  */
  const started = await startPayment({
    orderId: order.id,
    orderNumber: order.orderNumber,
    amountMinorUnits: coverage.outstandingCents,
    provider: method,
    payerMsisdn:
      normaliseBdMobile(order.contactPhone ?? "") ??
      normaliseBdMobile(order.shippingAddress.phone ?? ""),
    returnUrl: absolute(`${path}&awaiting=1`),
    cancelUrl: absolute(path),
    attempt: `after-${existing ?? "none"}`,
  });

  if (!started.ok) {
    return { kind: "unavailable", path, message: started.message };
  }

  // Point the order at the intent that can actually settle it. The old id is
  // not lost: every transfer against it is already a row in
  // jomma_applied_payments, which is what coverage reads.
  await db
    .update(orders)
    .set({ paymentIntentId: started.intentId })
    .where(eq(orders.id, order.id));

  return {
    kind: "pay",
    payUrl: started.payUrl,
    intentId: started.intentId,
    amountCents: coverage.outstandingCents,
  };
}

/**
 * The pay URL for an intent that can still take money, or null.
 *
 * Null covers every reason a buyer must not be sent to it: expired, cancelled,
 * already matched, or Jomma being unreachable. Deliberately treats an
 * unreachable Jomma as "not live" — raising a replacement is safe, because the
 * old intent's payments are already recorded and coverage counts them either
 * way, whereas sending somebody to a pay page we could not verify is not.
 */
async function liveIntent(
  intentId: string,
): Promise<{ payUrl: string } | null> {
  const { jomma } = await import("./client");
  try {
    const intent = await jomma().intents.get(intentId);
    const open = intent.status === "open" || intent.status === "partial";
    const deadlinePassed = new Date(intent.expires_at).getTime() < Date.now();
    // Both conditions, because this instance has been seen reporting intents
    // as `open` long past their own expires_at — see the note in ./sync.ts.
    if (!open || deadlinePassed) return null;
    return { payUrl: jomma().payUrl(intentId) };
  } catch {
    return null;
  }
}

/** Jomma needs somewhere absolute to send the buyer back to. */
function absolute(path: string): string {
  const origin = (process.env.BETTER_AUTH_URL ?? "").replace(/\/$/, "");
  return new URL(path, origin).toString();
}
