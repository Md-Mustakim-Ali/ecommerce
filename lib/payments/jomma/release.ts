import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, subOrders } from "@/lib/db/schema";

/**
 * Releases the stock an unpaid order was holding.
 *
 * `placeOrder` decrements stock in the same transaction that writes the order,
 * so an order that is never paid is sitting on inventory nobody can buy. When
 * Jomma reports the intent expired or was cancelled, that reservation has to
 * come back.
 *
 * The SQL mirrors the seller-side cancellation in lib/actions/fulfilment.ts on
 * purpose — one statement joining order_items back to the variants, so the
 * restore is a single atomic operation rather than a read-modify-write per
 * line that two concurrent releases could interleave.
 *
 * ── Idempotency ──────────────────────────────────────────────────────────
 *
 * Restoring stock twice invents inventory that does not exist, which is worse
 * than not restoring it at all — it oversells, and somebody's order gets
 * cancelled later by a human. So the order row is locked and re-checked
 * *inside* the transaction: only a still-`pending` order is released, and it
 * stops being pending in the same transaction that gives the stock back.
 *
 * The caller's status check is an optimisation. This one is the guarantee.
 */
export async function releaseOrderStock(
  orderId: string,
  reason: "expired" | "cancelled",
): Promise<{ released: boolean }> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update");

    if (!order) throw new Error(`Order ${orderId} not found`);

    /**
     * `unconfirmed` releases too, and holds stock for the same reason
     * `pending` does — placeOrder decrements inside the transaction that
     * writes the order, whether or not the buyer has proved their contact yet.
     * An abandoned guest checkout would otherwise sit on inventory forever.
     *
     * Anything else has been paid, cancelled, or already released.
     */
    if (order.status !== "pending" && order.status !== "unconfirmed") {
      return { released: false };
    }

    await tx.execute(sql`
      update product_variants v
      set stock = v.stock + oi.quantity
      from order_items oi
      join sub_orders so on so.id = oi.sub_order_id
      where so.order_id = ${orderId} and oi.variant_id = v.id
    `);

    await tx
      .update(orders)
      .set({ status: "cancelled" })
      .where(eq(orders.id, orderId));

    await tx
      .update(subOrders)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(eq(subOrders.orderId, orderId));

    console.info("[jomma] released stock", { orderId, reason });
    return { released: true };
  });
}
