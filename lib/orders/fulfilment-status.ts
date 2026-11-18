/**
 * What an order's sub-orders say about its fulfilment — and nothing else.
 *
 * ── Why this is its own module ───────────────────────────────────────────
 *
 * It lived inside lib/actions/fulfilment.ts, which carries "use server" and
 * reaches the database and the session, so the rule could not be exercised
 * without all of that standing up. It was therefore never tested, and it was
 * wrong.
 *
 * ── The rule, and the bug it used to have ────────────────────────────────
 *
 * An order's `status` column carries two different facts: whether it has been
 * paid for, and how far along fulfilment is. This function owns the second and
 * may never overwrite the first.
 *
 * It used to return `paid` when nothing had shipped, on the assumption that
 * anything reaching it was already paid. Nothing enforced that. Cancelling one
 * seller's part of a two-seller order runs this with the other part still
 * pending — so an unpaid order was marked `paid` because a seller cancelled
 * something. `paid` writes no ledger entries, so it claimed money that no
 * seller was credited for and no payout could ever include; and because
 * resumePayment reads a paid order as covered, the buyer lost the ability to
 * pay for what they still owed.
 *
 * `null` is the important return value: it means "fulfilment has nothing to
 * say, leave the status alone".
 */

export type SubOrderStatus =
  | "pending"
  | "accepted"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded";

/** What to write onto the order, or null to leave it as it is. */
export type DerivedOrderStatus =
  | "fulfilled"
  | "partially_fulfilled"
  | "cancelled"
  | "refunded"
  | null;

export function deriveOrderStatus(
  subStatuses: SubOrderStatus[],
): DerivedOrderStatus {
  // No sub-orders at all is not a state this should invent a status for.
  if (subStatuses.length === 0) return null;

  /*
    Cancelled and refunded parts drop out of "is everything shipped".

    An order with one cancelled part and one delivered part is fulfilled, not
    stuck waiting for something that is never coming.
  */
  const live = subStatuses.filter(
    (status) => status !== "cancelled" && status !== "refunded",
  );

  if (live.length === 0) {
    // Every part is gone. Refunded only when they all are — a mix of refunded
    // and cancelled is a cancelled order that happened to include a refund,
    // and calling it `refunded` would put a fictional refund in reporting.
    return subStatuses.every((status) => status === "refunded")
      ? "refunded"
      : "cancelled";
  }

  const done = live.filter(
    (status) => status === "shipped" || status === "delivered",
  );

  // The branch that used to lie. Fulfilment has not started, so it has no
  // opinion — whatever payment left on the order stays there.
  if (done.length === 0) return null;

  return done.length === live.length ? "fulfilled" : "partially_fulfilled";
}
