import { eq, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "@/lib/db";
import { ledgerEntries, orders, subOrders } from "@/lib/db/schema";
import { PLATFORM_CURRENCY } from "@/lib/money/currency";

/**
 * Ledger writes.
 *
 * Append-only, enforced by a database trigger rather than by discipline. A
 * refund is a new negative entry; a payout is a new negative entry. Nothing in
 * here ever updates or deletes a row, and the trigger would reject it if it
 * tried.
 *
 * Every write carries an idempotency key. Payment webhooks are delivered at
 * least once, so the same "payment succeeded" event will arrive twice sooner
 * or later, and crediting a seller twice for one sale is the exact failure
 * this table exists to make impossible.
 */

export type LedgerWrite = {
  storeId: string;
  subOrderId: string | null;
  type: "sale" | "commission" | "refund" | "adjustment" | "payout" | "fee";
  /** Signed. Credits positive, debits negative. */
  amountCents: bigint;
  currency: string;
  description: string;
  idempotencyKey: string;
};

/**
 * Records a paid order: a sale credit and a commission debit per sub-order.
 *
 * Runs in one transaction with the order status change, so an order can never
 * be marked paid without its ledger entries existing.
 *
 * Returns false when the order was already paid, which is the normal outcome
 * of a redelivered webhook rather than an error.
 */
export async function recordOrderPaid(
  db: Db,
  input: { orderId: string; paymentIntentId: string },
): Promise<{ recorded: boolean; entries: number }> {
  return db.transaction(async (tx) => {
    // Locked so two concurrent webhook deliveries cannot both pass the status
    // check before either writes.
    const [order] = await tx
      .select({
        id: orders.id,
        status: orders.status,
        currency: orders.currency,
        orderNumber: orders.orderNumber,
      })
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .for("update");

    if (!order) throw new Error(`Order ${input.orderId} not found`);

    // Already handled. A webhook arriving twice is expected, not exceptional.
    if (order.status !== "pending") return { recorded: false, entries: 0 };

    const subs = await tx
      .select({
        id: subOrders.id,
        storeId: subOrders.storeId,
        subtotalCents: subOrders.subtotalCents,
        shippingCents: subOrders.shippingCents,
        commissionCents: subOrders.commissionCents,
        payoutCents: subOrders.payoutCents,
      })
      .from(subOrders)
      .where(eq(subOrders.orderId, input.orderId));

    const writes: LedgerWrite[] = [];

    for (const sub of subs) {
      // The gross the seller earned before commission.
      writes.push({
        storeId: sub.storeId,
        subOrderId: sub.id,
        type: "sale",
        amountCents: BigInt(sub.subtotalCents + sub.shippingCents),
        currency: order.currency,
        description: `Sale on ${order.orderNumber}`,
        idempotencyKey: `sale:${sub.id}`,
      });

      if (sub.commissionCents > 0) {
        writes.push({
          storeId: sub.storeId,
          subOrderId: sub.id,
          type: "commission",
          // Negative: it is a debit against the seller's balance.
          amountCents: BigInt(-sub.commissionCents),
          currency: order.currency,
          description: `Commission on ${order.orderNumber}`,
          idempotencyKey: `commission:${sub.id}`,
        });
      }
    }

    if (writes.length > 0) {
      await tx
        .insert(ledgerEntries)
        .values(
          writes.map((write) => ({
            storeId: write.storeId,
            subOrderId: write.subOrderId,
            type: write.type,
            amountCents: write.amountCents,
            currency: write.currency,
            description: write.description,
            idempotencyKey: write.idempotencyKey,
          })),
        )
        // The unique index on idempotency_key is the real guard. If a webhook
        // somehow gets past the status check, this still refuses the duplicate.
        .onConflictDoNothing({ target: ledgerEntries.idempotencyKey });
    }

    await tx
      .update(orders)
      .set({ status: "paid", paymentIntentId: input.paymentIntentId })
      .where(eq(orders.id, input.orderId));

    await tx
      .update(subOrders)
      .set({ status: "accepted" })
      .where(eq(subOrders.orderId, input.orderId));

    return { recorded: true, entries: writes.length };
  });
}

/**
 * Records a refund as new negative entries.
 *
 * Never touches the original sale row. The commission is refunded
 * proportionally, so a seller is not left carrying the platform's cut on money
 * they had to give back.
 */
export async function recordRefund(
  db: DbOrTx,
  input: {
    subOrderId: string;
    amountCents: number;
    reason: string;
    idempotencyKey: string;
  },
): Promise<{ recorded: boolean }> {
  return db.transaction(async (tx) => {
    const [sub] = await tx
      .select({
        id: subOrders.id,
        storeId: subOrders.storeId,
        subtotalCents: subOrders.subtotalCents,
        shippingCents: subOrders.shippingCents,
        commissionCents: subOrders.commissionCents,
        orderId: subOrders.orderId,
      })
      .from(subOrders)
      .where(eq(subOrders.id, input.subOrderId))
      .for("update");

    if (!sub) throw new Error(`Sub-order ${input.subOrderId} not found`);

    const [order] = await tx
      .select({ currency: orders.currency, orderNumber: orders.orderNumber })
      .from(orders)
      .where(eq(orders.id, sub.orderId));

    const gross = sub.subtotalCents + sub.shippingCents;
    if (input.amountCents <= 0 || input.amountCents > gross) {
      throw new Error(
        `Refund of ${input.amountCents} is outside the ${gross} charged on this sub-order`,
      );
    }

    // Proportional, floored so the platform never returns more commission than
    // it took. The remainder stays with the platform, which is the
    // conservative direction for a refund.
    const commissionBack = Math.floor(
      (sub.commissionCents * input.amountCents) / gross,
    );

    const inserted = await tx
      .insert(ledgerEntries)
      .values([
        {
          storeId: sub.storeId,
          subOrderId: sub.id,
          type: "refund" as const,
          amountCents: BigInt(-input.amountCents),
          currency: order?.currency ?? PLATFORM_CURRENCY,
          description: `Refund on ${order?.orderNumber ?? sub.orderId}: ${input.reason}`,
          idempotencyKey: `refund:${input.idempotencyKey}`,
        },
        ...(commissionBack > 0
          ? [
              {
                storeId: sub.storeId,
                subOrderId: sub.id,
                type: "commission" as const,
                // Positive: returning the platform's cut to the seller.
                amountCents: BigInt(commissionBack),
                currency: order?.currency ?? PLATFORM_CURRENCY,
                description: `Commission returned on ${order?.orderNumber ?? sub.orderId}`,
                idempotencyKey: `commission-refund:${input.idempotencyKey}`,
              },
            ]
          : []),
      ])
      .onConflictDoNothing({ target: ledgerEntries.idempotencyKey })
      .returning({ id: ledgerEntries.id });

    if (inserted.length === 0) return { recorded: false };

    await tx
      .update(subOrders)
      .set({ status: "refunded" })
      .where(eq(subOrders.id, sub.id));

    return { recorded: true };
  });
}

/**
 * Unwinds a payment the verifier has withdrawn.
 *
 * ── What this is for, and why it is not a refund ─────────────────────────
 *
 * Jomma matches incoming bKash/Nagad Send Money messages to orders. A
 * `payment.reversed` webhook means it has un-matched one it previously
 * confirmed: the money we were told arrived did not, or was attributed to the
 * wrong order. Nobody gave anything back, so calling it a refund would put a
 * fiction in the seller's statement and in platform revenue.
 *
 * The ledger is append-only behind a database trigger, so this reverses by
 * writing new negative entries rather than deleting the originals. That is
 * deliberate: the audit trail should show that we believed we were paid, and
 * then learned otherwise, because that sequence is exactly what somebody
 * investigating a dispute needs to see.
 *
 * ── The one thing this cannot undo ───────────────────────────────────────
 *
 * If the seller already shipped, the goods are gone. This puts the money back
 * where it belongs in the ledger and marks the order `payment_reversed` so the
 * dashboards stop treating it as a sale, but recovering the item is a human
 * problem. That is the honest boundary of an automated reversal.
 */
export async function recordOrderReversed(
  db: Db,
  input: { orderId: string; reason: string; eventId: string },
): Promise<{ recorded: boolean; entries: number }> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select({
        id: orders.id,
        status: orders.status,
        currency: orders.currency,
        orderNumber: orders.orderNumber,
      })
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .for("update");

    if (!order) throw new Error(`Order ${input.orderId} not found`);

    // Only a payment we actually recognised can be un-recognised. A reversal
    // for an order still `pending` means the match never reached us in the
    // first place, and there is nothing in the ledger to unwind.
    if (order.status === "pending" || order.status === "payment_reversed") {
      return { recorded: false, entries: 0 };
    }

    const subs = await tx
      .select({
        id: subOrders.id,
        storeId: subOrders.storeId,
        subtotalCents: subOrders.subtotalCents,
        shippingCents: subOrders.shippingCents,
        commissionCents: subOrders.commissionCents,
      })
      .from(subOrders)
      .where(eq(subOrders.orderId, input.orderId));

    const writes: LedgerWrite[] = [];

    for (const sub of subs) {
      // Exactly mirrors what recordOrderPaid credited, so the two sum to zero.
      writes.push({
        storeId: sub.storeId,
        subOrderId: sub.id,
        type: "adjustment",
        amountCents: BigInt(-(sub.subtotalCents + sub.shippingCents)),
        currency: order.currency,
        description: `Payment reversed on ${order.orderNumber}: ${input.reason}`,
        idempotencyKey: `reversal:${sub.id}`,
      });

      if (sub.commissionCents > 0) {
        writes.push({
          storeId: sub.storeId,
          subOrderId: sub.id,
          type: "adjustment",
          // Positive: giving back the commission we debited for a sale that
          // turned out not to have happened.
          amountCents: BigInt(sub.commissionCents),
          currency: order.currency,
          description: `Commission reversed on ${order.orderNumber}`,
          idempotencyKey: `commission-reversal:${sub.id}`,
        });
      }
    }

    if (writes.length > 0) {
      await tx
        .insert(ledgerEntries)
        .values(writes)
        .onConflictDoNothing({ target: ledgerEntries.idempotencyKey });
    }

    await tx
      .update(orders)
      .set({ status: "payment_reversed" })
      .where(eq(orders.id, input.orderId));

    // Cancelled rather than refunded, for the same reason the order is not
    // `refunded`: no money went back to anybody.
    await tx
      .update(subOrders)
      .set({ status: "cancelled" })
      .where(eq(subOrders.orderId, input.orderId));

    return { recorded: true, entries: writes.length };
  });
}

/**
 * A store's balance.
 *
 * A SUM over immutable rows, never a stored column. AGENTS.md is explicit
 * about this, and it is the reason reconciliation is a query rather than a
 * thing that can silently drift.
 */
export async function storeBalance(
  db: DbOrTx,
  storeId: string,
  currency: string,
): Promise<bigint> {
  const [row] = await db
    .select({
      balance: sql<string>`coalesce(sum(${ledgerEntries.amountCents}), 0)`,
    })
    .from(ledgerEntries)
    .where(
      sql`${ledgerEntries.storeId} = ${storeId} and ${ledgerEntries.currency} = ${currency}`,
    );

  return BigInt(row?.balance ?? 0);
}

/** Ledger rows for a store, newest first. */
export async function storeLedger(db: DbOrTx, storeId: string, limit = 50) {
  return db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.storeId, storeId))
    .orderBy(sql`${ledgerEntries.createdAt} desc`)
    .limit(limit);
}
