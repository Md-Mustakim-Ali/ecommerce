"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/lib/auth/guards";
import { getCart, getOrCreateCartId } from "@/lib/cart";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { placeOrder } from "@/lib/orders/create";
import { paymentProvider } from "@/lib/payments";

/**
 * Checkout.
 *
 * Order creation and the payment intent are separate steps on purpose. The
 * order is written first, in one transaction with the stock decrement, and the
 * intent is created against an order that already exists — so a payment can
 * never reference an order that failed to persist.
 *
 * No money is recognised here. The ledger is written when the provider
 * confirms payment, which is the webhook's job.
 */

const addressSchema = z.object({
  recipientName: z.string().trim().min(1, "Enter a name").max(120),
  phone: z.string().trim().max(40).optional(),
  line1: z.string().trim().min(1, "Enter an address").max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1, "Enter a city").max(120),
  region: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().min(1, "Enter a postcode").max(40),
  countryCode: z.string().trim().length(2, "Use a 2-letter country code"),
});

const checkoutSchema = z.object({
  email: z.email("Enter a valid email"),
  shippingAddress: addressSchema,
});

export type CheckoutResult =
  | {
      ok: true;
      orderId: string;
      orderNumber: string;
      /** Present when the provider needs the buyer to do something. */
      redirectUrl?: string;
      settlesOffline: boolean;
    }
  | { ok: false; message: string };

/**
 * Flat shipping, for now.
 *
 * A real rate depends on the market, the carrier and the parcel, none of which
 * are decided. It is a single constant so there is exactly one place to change
 * when they are, rather than a formula that looks authoritative and is not.
 */
const FLAT_SHIPPING_CENTS = 599;
const FREE_SHIPPING_THRESHOLD_CENTS = 7500;
const CURRENCY = "USD";

export function shippingFor(subtotalCents: number): number {
  return subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS
    ? 0
    : FLAT_SHIPPING_CENTS;
}

export async function placeOrderAction(
  input: z.input<typeof checkoutSchema>,
): Promise<CheckoutResult> {
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }

  const session = await getSession();
  const cart = await getCart();

  if (cart.lines.length === 0) {
    return { ok: false, message: "Your cart is empty." };
  }
  if (cart.problems.length > 0) {
    return {
      ok: false,
      message: "Some items are no longer available in that quantity.",
    };
  }

  const cartId = await getOrCreateCartId();

  const result = await placeOrder({
    cartId,
    buyerId: session?.user.id ?? null,
    email: parsed.data.email,
    shippingAddress: parsed.data.shippingAddress,
    currency: CURRENCY,
    shippingCents: shippingFor(cart.subtotalCents),
  });

  if (!result.ok) return { ok: false, message: result.message };

  // The intent is created against a persisted order, so its id can be the
  // idempotency key — a retried checkout produces the same intent rather than
  // a second one.
  const provider = paymentProvider();
  const intent = await provider.createIntent({
    orderId: result.orderId,
    amountCents: result.totalCents,
    currency: CURRENCY,
    buyerEmail: parsed.data.email,
    idempotencyKey: `order:${result.orderId}`,
    metadata: { orderNumber: result.orderNumber },
  });

  await db
    .update(orders)
    .set({ paymentIntentId: intent.id })
    .where(eq(orders.id, result.orderId));

  revalidatePath("/account/orders");

  return {
    ok: true,
    orderId: result.orderId,
    orderNumber: result.orderNumber,
    redirectUrl: intent.redirectUrl,
    settlesOffline: provider.settlesOffline,
  };
}
