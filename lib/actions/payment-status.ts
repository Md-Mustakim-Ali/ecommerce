"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { claimantFrom, orderBelongsTo } from "@/lib/orders/ownership";
import {
  type PaymentSnapshot,
  syncOrderPayment,
} from "@/lib/payments/jomma/sync";

/**
 * What the order page's waiting card polls.
 *
 * Before this existed the page rendered a spinner and stopped. It was a CSS
 * animation over a server component that had already finished: it spun at the
 * same rate whether the payment had settled a minute earlier or had never been
 * sent, and the only way out was the buyer reloading by hand. The copy beside
 * it asked them to, which is the tell.
 *
 * Terminal states are answered from our own row without touching Jomma. An
 * order that is paid stays paid, and re-asking a payment provider about it on
 * every poll is load with no possible new information in it.
 */

export type PaymentStatusResult =
  | ({ ok: true } & PaymentSnapshot)
  | { ok: false; message: string };

export async function checkPaymentStatusAction(input: {
  orderId: string;
  /**
   * The `?t=` the order page was opened with, forwarded by the waiting card.
   *
   * Without it this action refused every caller who had no session, which is
   * every guest — the exact buyers this poll exists for, since a guest who has
   * just come back from Jomma has no other way to learn their payment landed.
   */
  accessToken?: string;
}): Promise<PaymentStatusResult> {
  const parsed = z.uuid().safeParse(input.orderId);
  if (!parsed.success) return { ok: false, message: "Unknown order." };
  const orderId = parsed.data;

  const session = await getSession();

  const [order] = await db
    .select({
      id: orders.id,
      buyerId: orders.buyerId,
      email: orders.email,
      contactPhone: orders.contactPhone,
      status: orders.status,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  // Deliberately the same answer for "no such order" and "not yours". A uuid is
  // not authorisation, and telling an attacker which of their guesses exist is
  // the whole value of walking them.
  if (!order) return { ok: false, message: "Unknown order." };

  if (!orderBelongsTo(order, claimantFrom(session, input.accessToken))) {
    return { ok: false, message: "Unknown order." };
  }

  const before = order.status;
  const snapshot = await syncOrderPayment(orderId);

  // Only when this call changed something. The page is a server component, so
  // it has to be re-rendered for the badge, the status and the seller's copy of
  // the order to catch up — but revalidating on every poll would throw away the
  // cache for a page that has not changed, several times a minute.
  if (snapshot.orderStatus !== before) {
    revalidatePath(`/orders/${orderId}`);
    revalidatePath("/account/orders");
  }

  return { ok: true, ...snapshot };
}
