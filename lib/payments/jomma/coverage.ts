import { eq } from "drizzle-orm";

/**
 * Whether an order has been paid for — across every intent ever raised for it.
 *
 * ── Why this is not "did the intent receive the total" ────────────────────
 *
 * It used to be. The webhook compared `received_amount` to the order total for
 * exact equality, and the poll refused to settle unless `intent.amount` was the
 * order total. Both were right while an order had exactly one intent for its
 * full price, which was true until a buyer could come back and finish paying.
 *
 * A buyer who pays ৳100 of ৳184 and lets the intent expire has to be given a
 * new one, and the only sane amount for it is the ৳84 still owed — asking for
 * ৳184 again would be asking them to pay twice. But then no single intent ever
 * sees the order total, so the old test can never be satisfied: the order stays
 * `pending` forever with the money sitting in it, and the webhook logs an
 * "amount mismatch" that is not a mismatch.
 *
 * So the question moves up a level. Jomma is still the authority on what
 * arrived — every row in `jomma_applied_payments` was written from its report,
 * never from anything the browser said — and what we ask is whether all of it
 * adds up to the price.
 *
 * ── The guard that was lost, and where it went ───────────────────────────
 *
 * The exact-equality check was doing real work: it caught our own amount
 * handling being wrong before it became a shipped parcel. That protection now
 * lives in `startPayment`'s callers, which must raise an intent for exactly
 * what is outstanding, and in `overpaidCents` below — an order that received
 * more than it asked for is reported rather than quietly banked.
 */

export type Coverage = {
  totalCents: number;
  /** Summed across every intent, not just the current one. */
  receivedCents: number;
  /** What the buyer still owes. 0 once covered. */
  outstandingCents: number;
  /** What they sent beyond the total. A debt back to them, not income. */
  overpaidCents: number;
  /** Whether the order is paid for. */
  covered: boolean;
};

export function coverageOf(input: {
  totalCents: number;
  receivedCents: number;
}): Coverage {
  const { totalCents, receivedCents } = input;
  return {
    totalCents,
    receivedCents,
    outstandingCents: Math.max(0, totalCents - receivedCents),
    overpaidCents: Math.max(0, receivedCents - totalCents),
    // `>=` rather than `===`. An overpayment is still a paid order — refusing
    // to fulfil because somebody sent too much would be the wrong way round.
    covered: receivedCents >= totalCents,
  };
}

/**
 * Reads what an order has received, from our own rows.
 *
 * Deliberately not from Jomma. These rows are written by the webhook and by
 * the poll from Jomma's own reports, so they are already its answer — and an
 * order that is being fulfilled must not depend on a payment provider being
 * reachable at that moment.
 */
export async function coverageForOrder(orderId: string): Promise<Coverage> {
  /*
    Imported here rather than at the top of the file, so that `coverageOf` —
    the rule that decides an order is paid for — can be imported and tested
    without an environment. lib/db reaches lib/env, which parses the whole
    environment at module load, and a pure arithmetic rule should not need a
    database connection string to be exercised.
  */
  const { db } = await import("@/lib/db");
  const { jommaAppliedPayments, orders } = await import("@/lib/db/schema");

  const [order] = await db
    .select({ totalCents: orders.totalCents })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!order) throw new Error(`Order ${orderId} not found`);

  const rows = await db
    .select({ amountCents: jommaAppliedPayments.amountCents })
    .from(jommaAppliedPayments)
    .where(eq(jommaAppliedPayments.orderId, orderId));

  return coverageOf({
    totalCents: order.totalCents,
    receivedCents: rows.reduce((total, row) => total + row.amountCents, 0),
  });
}
