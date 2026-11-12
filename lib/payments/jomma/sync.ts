import type { Intent } from "@jomma/sdk";
import { JommaError } from "@jomma/sdk";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jommaAppliedPayments } from "@/lib/db/schema/jomma";
import { orders } from "@/lib/db/schema/orders";
import { sendOrderConfirmation } from "@/lib/email/notify";
import { recordOrderPaid } from "@/lib/money/ledger";
import { jomma } from "./client";

/**
 * Asking Jomma what actually happened to an order's payment.
 *
 * ── Why this exists at all ───────────────────────────────────────────────
 *
 * The webhook is push, and push has exactly one failure mode that matters: it
 * does not arrive. A signature mismatch, an endpoint that was unreachable for
 * the whole retry window, a hostname never registered — in every one of those
 * cases Jomma knows the money arrived and this application never finds out. The
 * order then sits `pending` forever, holding stock, while the buyer looks at a
 * page that says we are checking. Nothing in the system was checking.
 *
 * `intents.get()` is the pull half. The SDK documents it as something to poll,
 * and it returns strictly more than the webhook does — `payments[]` carries
 * every transfer applied to the intent, where a `payment.succeeded` event
 * carries only the one that completed it.
 *
 * ── Why this is allowed to mark an order paid ────────────────────────────
 *
 * The rule in docs/jomma.md is that `returnUrl` proves nothing, and that rule
 * is untouched: a buyer landing on a page still cannot settle an order. What
 * settles it here is an authenticated server-to-server GET, carrying
 * JOMMA_API_KEY, whose response says the intent is matched. That is the same
 * authority as a signed webhook arriving by a different route — Jomma is the
 * witness in both cases. What is *not* trusted is anything the browser said.
 *
 * The write goes through `recordOrderPaid`, the identical ledger path the
 * webhook uses, which locks the order row `for update` and returns
 * `recorded: false` if it is no longer pending. So a poll racing a webhook
 * cannot double-credit a seller or send two receipts; exactly one wins.
 */

/** What the order page and its poller need. Never the raw SDK type. */
export type PaymentSnapshot = {
  /** Our order status, re-read after any reconciliation this call performed. */
  orderStatus: string;
  /**
   * Jomma's view. Null when the order has no Jomma intent, or when Jomma could
   * not be reached — `reachable` tells those apart.
   */
  intentStatus: Intent["status"] | null;
  /** False when Jomma is down or the intent is gone. The UI must say so. */
  reachable: boolean;
  totalCents: number;
  receivedCents: number;
  /** What the buyer still owes. 0 once covered. */
  shortfallCents: number;
  /** What they sent beyond the total. A debt back to them, not income. */
  excessCents: number;
  /** The code the buyer quotes in their transfer, while one is live. */
  refCode: string | null;
  /** Where to send them to finish or top up. Null when there is nothing to pay. */
  payUrl: string | null;
  expiresAt: string | null;
  /**
   * Whether there is still any point waiting.
   *
   * Not simply `intentStatus === "expired"`, and the difference is not
   * theoretical: this instance returns intents whose `expires_at` passed more
   * than a day ago still reporting `open`, and it never delivered the
   * `payment.expired` webhook that should have closed them. Trusting the status
   * field alone would leave a buyer watching a spinner for an intent that can
   * no longer be paid, which is the bug this whole change is about — so the
   * deadline is checked as well as the label.
   *
   * Deliberately not applied when money has arrived. An intent past its TTL
   * holding a payment is a reconciliation problem for a person, not something
   * to quietly write off as expired.
   */
  expired: boolean;
  /** Every transfer applied, oldest first. More than one means a split. */
  payments: AppliedPaymentView[];
};

export type AppliedPaymentView = {
  trxId: string | null;
  senderMsisdn: string | null;
  amountCents: number;
  occurredAt: string | null;
  appliedAt: string;
  matchConfidence: string;
  matchedBy: string;
};

/**
 * Reconciles one order against Jomma and returns what both sides now say.
 *
 * Never throws for an unreachable Jomma. This is called from a page and from a
 * poller, and a payment provider having a bad minute must degrade to "we could
 * not check just now" rather than to an error boundary over the buyer's order.
 */
export async function syncOrderPayment(
  orderId: string,
): Promise<PaymentSnapshot> {
  const [order] = await db
    .select({
      id: orders.id,
      status: orders.status,
      totalCents: orders.totalCents,
      paymentIntentId: orders.paymentIntentId,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!order) throw new Error(`Order ${orderId} not found`);

  const stored = await readStoredPayments(orderId);

  // No Jomma intent: a manual or demo order. There is nothing to ask about, and
  // asking would 404. `manual_…` intent ids live in the same column.
  const intentId = order.paymentIntentId;
  if (!intentId?.startsWith("int_")) {
    return {
      orderStatus: order.status,
      intentStatus: null,
      reachable: false,
      totalCents: order.totalCents,
      receivedCents: sum(stored),
      shortfallCents: Math.max(0, order.totalCents - sum(stored)),
      excessCents: Math.max(0, sum(stored) - order.totalCents),
      refCode: null,
      payUrl: null,
      expiresAt: null,
      expired: false,
      payments: stored,
    };
  }

  let intent: Intent;
  try {
    intent = await jomma().intents.get(intentId);
  } catch (error) {
    // Degraded, not broken. Everything already stored is still true, so the
    // page renders from the database and says the live check failed.
    console.error("[jomma] intents.get failed", {
      orderId,
      intentId,
      code: error instanceof JommaError ? error.code : undefined,
      requestId: error instanceof JommaError ? error.requestId : undefined,
    });
    return {
      orderStatus: order.status,
      intentStatus: null,
      reachable: false,
      totalCents: order.totalCents,
      receivedCents: sum(stored),
      shortfallCents: Math.max(0, order.totalCents - sum(stored)),
      excessCents: Math.max(0, sum(stored) - order.totalCents),
      refCode: null,
      payUrl: null,
      expiresAt: null,
      expired: false,
      payments: stored,
    };
  }

  await persistAppliedPayments(orderId, intentId, intent);

  let status = order.status;

  /*
    The reconcile.

    Only from `pending`, and only when Jomma says it has at least the full
    amount. `matched` and `over` are the two states that mean covered — the
    webhook fulfils on succeeded and overpaid for the same reason.

    The amount guard mirrors the webhook's, with one deliberate difference: the
    webhook compares `received_amount` for exact equality, which is right for a
    `payment.succeeded` event but would refuse a legitimate overpayment here.
    What must hold is that the intent was raised for this order's total — if it
    was not, our own amount handling is wrong and shipping is the last thing to
    do about it.
  */
  const covered = intent.status === "matched" || intent.status === "over";
  if (covered && order.status === "pending") {
    if (intent.amount !== order.totalCents) {
      console.error("[jomma] intent amount does not match order", {
        orderId,
        intentId,
        orderTotal: order.totalCents,
        intentAmount: intent.amount,
      });
    } else if (intent.received_amount >= order.totalCents) {
      const result = await recordOrderPaid(db, {
        orderId,
        paymentIntentId: intentId,
      });
      if (result.recorded) {
        status = "paid";
        // Same rule as the webhook: only the call that actually recorded it
        // sends a receipt, so a poll and a webhook racing send one email.
        await sendOrderConfirmation(orderId);
        console.info("[jomma] order settled by poll, not webhook", {
          orderId,
          intentId,
          received: intent.received_amount,
        });
      } else {
        // Something else got there first between our read and the lock.
        const [fresh] = await db
          .select({ status: orders.status })
          .from(orders)
          .where(eq(orders.id, orderId))
          .limit(1);
        status = fresh?.status ?? status;
      }
    }
  }

  /*
    Whether it is still worth waiting.

    `deadlinePassed` is checked alongside the status because this instance has
    been observed returning intents more than a day past `expires_at` still
    labelled `open`, with no `payment.expired` webhook ever delivered for them.
    Reading the label alone would put a buyer in front of a spinner that can
    never resolve — the exact failure this module was written to end.

    Money already received suspends the judgement: an intent past its TTL with a
    transfer against it is a reconciliation problem for a person, and writing it
    off as expired would tell the buyer nothing arrived when something did.
  */
  const deadlinePassed = new Date(intent.expires_at).getTime() < Date.now();
  const expired =
    intent.status === "expired" ||
    intent.status === "cancelled" ||
    (deadlinePassed && intent.received_amount === 0);

  return {
    orderStatus: status,
    intentStatus: intent.status,
    reachable: true,
    totalCents: order.totalCents,
    receivedCents: intent.received_amount,
    shortfallCents: intent.shortfall,
    excessCents: intent.excess,
    refCode: intent.ref_code,
    // Only worth offering while there is something left to pay, and only while
    // it can still be paid. A matched intent's pay page has nothing for the
    // buyer to do, and a dead one's would take their money into a void.
    payUrl:
      !expired && (intent.status === "open" || intent.status === "partial")
        ? jomma().payUrl(intentId)
        : null,
    expiresAt: intent.expires_at,
    expired,
    payments: await readStoredPayments(orderId),
  };
}

/**
 * Stores `Intent.payments[]`, ignoring rows already held.
 *
 * Exported because the webhook calls it too: an event tells us the state
 * changed, and this is what turns that into the full list of transfers behind
 * it. Best-effort by contract — see the call site.
 */
export async function persistAppliedPayments(
  orderId: string,
  intentId: string,
  intent: Pick<Intent, "payments">,
): Promise<void> {
  if (intent.payments.length === 0) return;

  await db
    .insert(jommaAppliedPayments)
    .values(
      intent.payments.map((payment) => ({
        orderId,
        intentId,
        trxId: payment.trx_id,
        senderMsisdn: payment.sender_msisdn,
        amountCents: payment.amount,
        occurredAt: payment.occurred_at ? new Date(payment.occurred_at) : null,
        appliedAt: new Date(payment.applied_at),
        matchConfidence: payment.match_confidence,
        matchedBy: payment.matched_by,
      })),
    )
    /*
      Re-syncing the same intent is the normal case, not the exceptional one —
      the order page polls it every few seconds.

      Untargeted deliberately. The unique index behind this is on an expression
      (`coalesce(trx_id, '')`, so that a null TrxID still collides), and a
      conflict target has to name an index exactly; a column list would not
      match it. Bare `on conflict do nothing` lets Postgres use whichever unique
      index was violated, which is the semantics wanted here anyway.
    */
    .onConflictDoNothing();
}

/** Fetches an intent purely to store its transfers. Used by the webhook. */
export async function fetchAndPersistAppliedPayments(
  orderId: string,
  intentId: string,
): Promise<void> {
  const intent = await jomma().intents.get(intentId);
  await persistAppliedPayments(orderId, intentId, intent);
}

async function readStoredPayments(
  orderId: string,
): Promise<AppliedPaymentView[]> {
  const rows = await db
    .select()
    .from(jommaAppliedPayments)
    .where(eq(jommaAppliedPayments.orderId, orderId))
    .orderBy(jommaAppliedPayments.appliedAt);

  return rows.map((row) => ({
    trxId: row.trxId,
    senderMsisdn: row.senderMsisdn,
    amountCents: row.amountCents,
    occurredAt: row.occurredAt?.toISOString() ?? null,
    appliedAt: row.appliedAt.toISOString(),
    matchConfidence: row.matchConfidence,
    matchedBy: row.matchedBy,
  }));
}

function sum(payments: AppliedPaymentView[]): number {
  return payments.reduce((total, payment) => total + payment.amountCents, 0);
}
