"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStorePermission } from "@/lib/auth/access";
import { getSession } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { auditLog, orders, stores, subOrders } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { shipmentNotice } from "@/lib/email/templates";

/**
 * Fulfilment actions for a seller.
 *
 * Each one checks the specific permission it needs against the specific store,
 * so a fulfilment role can ship without being able to cancel or refund.
 *
 * The parent order's status is recomputed after every change rather than
 * stored independently. With several sellers on one order it is only fulfilled
 * once all of them are, and only partially fulfilled while some are — deriving
 * that is the only way it stays true.
 */

export type FulfilmentResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

async function ownedSubOrder(subOrderId: string, storeId: string) {
  const [row] = await db
    .select({
      id: subOrders.id,
      orderId: subOrders.orderId,
      status: subOrders.status,
    })
    .from(subOrders)
    .where(and(eq(subOrders.id, subOrderId), eq(subOrders.storeId, storeId)))
    .limit(1);
  return row ?? null;
}

/**
 * Recomputes the parent order's status from its sub-orders.
 *
 * Cancelled and refunded sub-orders are excluded from the "is everything
 * shipped" question — an order with one cancelled part and one delivered part
 * is fulfilled, not stuck.
 */
async function syncOrderStatus(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  orderId: string,
) {
  const rows = await tx
    .select({ status: subOrders.status })
    .from(subOrders)
    .where(eq(subOrders.orderId, orderId));

  const live = rows.filter(
    (r) => r.status !== "cancelled" && r.status !== "refunded",
  );

  if (live.length === 0) {
    const allRefunded = rows.every((r) => r.status === "refunded");
    await tx
      .update(orders)
      .set({ status: allRefunded ? "refunded" : "cancelled" })
      .where(eq(orders.id, orderId));
    return;
  }

  const done = live.filter(
    (r) => r.status === "shipped" || r.status === "delivered",
  );

  const status =
    done.length === 0
      ? "paid"
      : done.length === live.length
        ? "fulfilled"
        : "partially_fulfilled";

  await tx.update(orders).set({ status }).where(eq(orders.id, orderId));
}

export async function acceptOrderAction(input: {
  storeId: string;
  subOrderId: string;
}): Promise<FulfilmentResult> {
  const storeId = z.uuid().parse(input.storeId);
  const subOrderId = z.uuid().parse(input.subOrderId);
  await requireStorePermission(storeId, "order.accept");

  const sub = await ownedSubOrder(subOrderId, storeId);
  if (!sub) return { ok: false, message: "Order not found." };
  if (sub.status !== "pending" && sub.status !== "accepted") {
    return {
      ok: false,
      message: `Cannot accept an order that is ${sub.status}.`,
    };
  }

  await db
    .update(subOrders)
    .set({ status: "accepted", acceptedAt: new Date() })
    .where(eq(subOrders.id, subOrderId));

  revalidatePath(`/dashboard/${storeId}/orders`);
  return { ok: true, message: "Accepted." };
}

const shipSchema = z.object({
  storeId: z.uuid(),
  subOrderId: z.uuid(),
  carrier: z.string().trim().min(1, "Enter a carrier").max(60),
  trackingNumber: z.string().trim().min(1, "Enter a tracking number").max(120),
});

export async function shipOrderAction(
  input: z.input<typeof shipSchema>,
): Promise<FulfilmentResult> {
  const parsed = shipSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const { storeId, subOrderId, carrier, trackingNumber } = parsed.data;
  await requireStorePermission(storeId, "order.ship");

  const sub = await ownedSubOrder(subOrderId, storeId);
  if (!sub) return { ok: false, message: "Order not found." };
  if (sub.status === "cancelled" || sub.status === "refunded") {
    return {
      ok: false,
      message: `Cannot ship an order that is ${sub.status}.`,
    };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(subOrders)
      .set({
        status: "shipped",
        trackingCarrier: carrier,
        trackingNumber,
        shippedAt: new Date(),
      })
      .where(eq(subOrders.id, subOrderId));

    await syncOrderStatus(tx, sub.orderId);
  });

  // After the transaction commits, and never inside it. Mail cannot be
  // un-sent, so telling a buyer their parcel shipped and then rolling the
  // shipment back would leave them waiting for something that is not coming.
  await notifyShipped(subOrderId);

  revalidatePath(`/dashboard/${storeId}/orders`);
  return { ok: true, message: "Marked shipped." };
}

/**
 * Tells the buyer their parcel is on its way.
 *
 * Failures are swallowed by sendEmail. The order has shipped either way, and
 * refusing to record a real shipment because a mail provider was down would be
 * the wrong trade.
 */
async function notifyShipped(subOrderId: string) {
  const [row] = await db
    .select({
      email: orders.email,
      orderNumber: orders.orderNumber,
      orderId: orders.id,
      storeName: stores.name,
      carrier: subOrders.trackingCarrier,
      trackingNumber: subOrders.trackingNumber,
    })
    .from(subOrders)
    .innerJoin(orders, eq(orders.id, subOrders.orderId))
    .innerJoin(stores, eq(stores.id, subOrders.storeId))
    .where(eq(subOrders.id, subOrderId))
    .limit(1);

  if (!row) return;

  await sendEmail(
    shipmentNotice({
      to: row.email,
      orderNumber: row.orderNumber,
      orderId: row.orderId,
      storeName: row.storeName,
      carrier: row.carrier,
      trackingNumber: row.trackingNumber,
    }),
  );
}

export async function markDeliveredAction(input: {
  storeId: string;
  subOrderId: string;
}): Promise<FulfilmentResult> {
  const storeId = z.uuid().parse(input.storeId);
  const subOrderId = z.uuid().parse(input.subOrderId);
  await requireStorePermission(storeId, "order.ship");

  const sub = await ownedSubOrder(subOrderId, storeId);
  if (!sub) return { ok: false, message: "Order not found." };
  if (sub.status !== "shipped") {
    return {
      ok: false,
      message: "Only a shipped order can be marked delivered.",
    };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(subOrders)
      .set({ status: "delivered", deliveredAt: new Date() })
      .where(eq(subOrders.id, subOrderId));
    await syncOrderStatus(tx, sub.orderId);
  });

  revalidatePath(`/dashboard/${storeId}/orders`);
  return { ok: true, message: "Marked delivered." };
}

const cancelSchema = z.object({
  storeId: z.uuid(),
  subOrderId: z.uuid(),
  reason: z.string().trim().min(1, "Give a reason").max(200),
});

/**
 * Cancels a sub-order and returns its stock.
 *
 * Stock goes back in the same transaction. A cancellation that forgets to
 * restock is how a catalogue quietly runs out of things it still has.
 */
export async function cancelOrderAction(
  input: z.input<typeof cancelSchema>,
): Promise<FulfilmentResult> {
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const { storeId, subOrderId, reason } = parsed.data;
  await requireStorePermission(storeId, "order.cancel");

  const session = await getSession();
  if (!session) return { ok: false, message: "Not signed in." };

  const sub = await ownedSubOrder(subOrderId, storeId);
  if (!sub) return { ok: false, message: "Order not found." };
  if (sub.status === "shipped" || sub.status === "delivered") {
    return {
      ok: false,
      message: "This has already shipped. Start a refund instead.",
    };
  }
  if (sub.status === "cancelled") {
    return { ok: false, message: "Already cancelled." };
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      update product_variants v
      set stock = v.stock + oi.quantity
      from order_items oi
      where oi.sub_order_id = ${subOrderId} and oi.variant_id = v.id
    `);

    await tx
      .update(subOrders)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(eq(subOrders.id, subOrderId));

    await tx.insert(auditLog).values({
      storeId,
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: "order.cancel",
      targetType: "sub_order",
      targetId: subOrderId,
      before: { status: sub.status },
      after: { status: "cancelled", reason },
    });

    await syncOrderStatus(tx, sub.orderId);
  });

  revalidatePath(`/dashboard/${storeId}/orders`);
  return { ok: true, message: "Cancelled and stock returned." };
}
