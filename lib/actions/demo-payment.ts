"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { sendOrderConfirmation } from "@/lib/email/notify";
import { recordOrderPaid } from "@/lib/money/ledger";
import { contactsFromSession, orderBelongsTo } from "@/lib/orders/ownership";

/**
 * Marks an order paid without any money moving.
 *
 * A stand-in until a real provider is wired up. The manual adapter settles
 * offline, which means an order stays pending until something confirms it —
 * correct for cash on delivery, useless for exercising the rest of the system,
 * because fulfilment, payouts and the ledger all begin at "paid".
 *
 * This runs the same `recordOrderPaid` the webhook runs. That matters: the
 * ledger entries, the commission split and the idempotency guard are the real
 * ones, so everything downstream is exercising production code paths on
 * genuinely-shaped data. The only fiction is that a card was charged.
 *
 * Refuses to run outside development. A build that can mark its own orders
 * paid is a build that can be robbed.
 */

export type DemoPaymentResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export async function confirmDemoPaymentAction(input: {
  orderId: string;
}): Promise<DemoPaymentResult> {
  if (process.env.NODE_ENV === "production") {
    return { ok: false, message: "Not available." };
  }

  const orderId = z.uuid().parse(input.orderId);
  const session = await getSession();

  const [order] = await db
    .select({
      id: orders.id,
      buyerId: orders.buyerId,
      email: orders.email,
      contactPhone: orders.contactPhone,
      status: orders.status,
      orderNumber: orders.orderNumber,
      paymentIntentId: orders.paymentIntentId,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!order) return { ok: false, message: "Order not found." };

  // Even in a demo, only the person who placed it. Otherwise any signed-in
  // account could walk order ids and settle other people's carts.
  if (!session || !orderBelongsTo(order, contactsFromSession(session))) {
    return { ok: false, message: "That is not your order." };
  }

  if (order.status !== "pending") {
    return {
      ok: false,
      message: `This order is already ${order.status}.`,
    };
  }

  const result = await recordOrderPaid(db, {
    orderId: order.id,
    paymentIntentId: order.paymentIntentId ?? `demo_${order.id}`,
  });

  // Only on the settle that actually recorded it. recordOrderPaid is
  // idempotent, so a second call returns recorded: false — sending here
  // unconditionally would mail a duplicate receipt on every retry.
  if (result.recorded) {
    await sendOrderConfirmation(order.id);
  }

  revalidatePath(`/orders/${order.id}`);
  revalidatePath("/account/orders");

  return {
    ok: true,
    message: result.recorded
      ? `${order.orderNumber} marked paid. ${result.entries} ledger entries written.`
      : "Already settled.",
  };
}
