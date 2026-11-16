import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orderItems, orders, subOrders } from "@/lib/db/schema";
import { sendEmail } from "./index";
import { orderConfirmation, orderPlaced } from "./templates";

/**
 * Notifications that more than one caller needs to send.
 *
 * The confirmation in particular is sent from both the payment webhook and the
 * development settle path. Duplicating the query in both would mean fixing any
 * bug in it twice, and the second copy is the one that gets missed.
 *
 * Everything here reads its own data rather than taking it as arguments. A
 * caller assembling the lines itself is a caller that can assemble them wrong,
 * and a receipt that disagrees with the order is worse than no receipt.
 */

/**
 * Sends the "we have your order" note, at placement.
 *
 * Every other message here fires on a payment event, which left a gap wide
 * enough to lose a buyer in: `manual` — pay on delivery or bank transfer — is
 * the default method and the usual one here, so an order sits pending for days
 * and nothing was ever sent. The only copy of the signed order link was the
 * confirmation page shown once after checkout, so a guest who closed that tab
 * could not reach their own order again.
 *
 * Deliberately quiet about accounts. Somebody who wants one can make one; that
 * is its own flow with its own verification.
 */
export async function sendOrderPlaced(
  orderId: string,
  settlesOffline: boolean,
): Promise<void> {
  const [order] = await db
    .select({
      id: orders.id,
      email: orders.email,
      orderNumber: orders.orderNumber,
      totalCents: orders.totalCents,
      currency: orders.currency,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  // A buyer who checked out with a number alone has nothing to email. The
  // order page still works from the link they were just shown.
  if (!order?.email) return;

  await sendEmail(
    orderPlaced({
      to: order.email,
      orderNumber: order.orderNumber,
      orderId: order.id,
      currency: order.currency,
      totalCents: order.totalCents,
      settlesOffline,
    }),
  );
}

/**
 * Sends the order confirmation.
 *
 * Called after payment is recorded, never before. A confirmation for an order
 * whose payment then fails is a promise the marketplace cannot keep.
 *
 * Returns quietly on any problem — sendEmail already logs, and nothing
 * upstream should fail because of this.
 */
export async function sendOrderConfirmation(orderId: string): Promise<void> {
  const [order] = await db
    .select({
      id: orders.id,
      email: orders.email,
      orderNumber: orders.orderNumber,
      totalCents: orders.totalCents,
      currency: orders.currency,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!order) return;

  /**
   * A buyer who checked out with a number alone has nothing to email.
   *
   * Returning quietly rather than inventing an address: this function is
   * called from the payment path, and an order that settled must not fail
   * because there was no receipt to send. The confirmation is on screen and on
   * the order page either way, and an SMS receipt is the obvious follow-up
   * once lib/sms has a real gateway behind it.
   */
  if (!order.email) return;

  const lines = await db
    .select({
      title: orderItems.productTitle,
      variantLabel: orderItems.variantLabel,
      quantity: orderItems.quantity,
      lineTotalCents: orderItems.lineTotalCents,
      subOrderId: orderItems.subOrderId,
    })
    .from(orderItems)
    .innerJoin(subOrders, eq(subOrders.id, orderItems.subOrderId))
    .where(eq(subOrders.orderId, orderId))
    .orderBy(asc(orderItems.createdAt));

  if (lines.length === 0) return;

  await sendEmail(
    orderConfirmation({
      to: order.email,
      orderNumber: order.orderNumber,
      orderId: order.id,
      currency: order.currency,
      totalCents: order.totalCents,
      lines: lines.map((line) => ({
        title: line.title,
        variantLabel: line.variantLabel,
        quantity: line.quantity,
        lineTotalCents: line.lineTotalCents,
      })),
      // Counted from the items rather than queried separately, so the number
      // in the email always matches the parcels the buyer will receive.
      storeCount: new Set(lines.map((line) => line.subOrderId)).size,
    }),
  );
}
