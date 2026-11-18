import type { Intent } from "@jomma/sdk";
import { JommaError } from "@jomma/sdk";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jommaAppliedPayments } from "@/lib/db/schema/jomma";
import { orders } from "@/lib/db/schema/orders";
import { sendOrderConfirmation } from "@/lib/email/notify";
import { recordOrderPaid } from "@/lib/money/ledger";
import { jomma } from "./client";
import { coverageOf } from "./coverage";

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
  /** Which intent this transfer arrived against. An order can have several. */
  intentId: string;
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

    Asked of the ORDER, not of this intent — see lib/payments/jomma/coverage.ts.
    An order that expired half-paid gets a new intent for the balance, so no
    single intent ever sees the full price and "did this intent receive the
    total" can never come true. What must hold is that everything Jomma has
    reported for this order adds up to what the order costs.

    Read after persistAppliedPayments deliberately: that call is what turns this
    intent's `payments[]` into rows, so reading before it would miss the very
    transfer that just completed the order.

    Computed from the rows this function already has to load rather than through
    coverageForOrder, which would be a second query for an answer we are holding.
  */
  const settled = await readStoredPayments(orderId);
  const coverage = coverageOf({
    totalCents: order.totalCents,
    receivedCents: receivedAcrossIntents(settled, intentId, intent),
  });

  /*
    Two conditions, and both are load-bearing.

    Coverage answers "has enough money arrived", across every intent this order
    has had. `matched`/`over` answers "did Jomma accept it" — money sitting
    against an expired or cancelled intent has arrived without being matched to
    anything, which is a reconciliation problem for a person and never an
    instruction to ship. Dropping this second half meant a dead intent holding
    the full amount settled itself.
  */
  const accepted = intent.status === "matched" || intent.status === "over";
  if (accepted && coverage.covered && order.status === "pending") {
    {
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
          received: coverage.receivedCents,
          total: coverage.totalCents,
        });
        if (coverage.overpaidCents > 0) {
          console.warn("[jomma] OVERPAID — refund owed to buyer", {
            orderId,
            excess: coverage.overpaidCents,
          });
        }
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
    /*
      Only while this intent can still take money.

      Keyed on `deadlinePassed`, NOT on `expired`, and the difference was a real
      bug. `expired` carries a deliberate exception — an intent past its
      deadline holding a payment is not written off, because money that arrived
      is a reconciliation problem rather than a lapse. That exception is right
      for deciding whether to give up on an intent and wrong for deciding
      whether to link to it: a buyer who part-paid and let the clock run out is
      exactly the person `expired` keeps false, so they were handed a live
      looking link to a dead pay page, and it failed when they pressed it.

      Anyone in that position needs a *new* intent for the balance, which is
      what /api/orders/pay does. Nothing here should offer them a URL at all.
    */
    payUrl:
      !deadlinePassed &&
      (intent.status === "open" || intent.status === "partial")
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
    intentId: row.intentId,
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

/**
 * What this order has received in total, trusting the better source per intent.
 *
 * Two sources disagree, and both are Jomma's. `payments[]` is the itemised
 * breakdown that becomes our rows; `received_amount` is the intent's own
 * total. They should be equal, and for the intent in front of us they usually
 * are — but `payments[]` has been seen arriving short, and settling an order is
 * the one decision where quietly undercounting means refusing to ship
 * something that was genuinely paid for.
 *
 * So: every other intent contributes its stored rows, which is the only record
 * of it we have, and the current one contributes whichever of its two numbers
 * is larger. Taking the larger cannot over-credit, because both are Jomma's own
 * statements about the same transfers.
 */
function receivedAcrossIntents(
  stored: AppliedPaymentView[],
  currentIntentId: string,
  intent: Intent,
): number {
  const fromOthers = sum(stored.filter((p) => p.intentId !== currentIntentId));
  const fromThis = sum(stored.filter((p) => p.intentId === currentIntentId));
  return fromOthers + Math.max(fromThis, intent.received_amount);
}
