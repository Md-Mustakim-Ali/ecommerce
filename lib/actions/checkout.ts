"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/lib/auth/guards";
import { getCart, getOrCreateCartId } from "@/lib/cart";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { resolveDiscountForCart } from "@/lib/discounts/resolve";
import { placeOrder } from "@/lib/orders/create";
import { paymentProvider } from "@/lib/payments";
import { callerKey, checkRateLimit } from "@/lib/ratelimit";
import { getPlatformSettings, shippingFor } from "@/lib/settings";

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
  /** Optional. Re-evaluated here; the browser's figure is never trusted. */
  discountCode: z.string().trim().max(60).optional(),
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

const CURRENCY = "USD";

export async function placeOrderAction(
  input: z.input<typeof checkoutSchema>,
): Promise<CheckoutResult> {
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }

  const session = await getSession();

  // Before any work, and keyed on the account when there is one so a signed-in
  // attacker cannot get a fresh allowance by changing address. Card testing —
  // running stolen numbers through a checkout to see which still work — is the
  // thing this stops, and the chargebacks for it land on this platform.
  const limit = await checkRateLimit(
    "checkout",
    session?.user.id ?? (await callerKey()),
  );
  if (!limit.ok) return { ok: false, message: limit.message };

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

  // Read once and passed down, so the rate that priced the order is the one
  // recorded on it. Reading it again inside placeOrder could pick up a change
  // made between the two calls.
  const settings = await getPlatformSettings();
  let shippingCents = shippingFor(cart.subtotalCents, settings);
  let discountCents = 0;
  let redeeming: { id: string; code: string; amountCents: number } | undefined;

  // Recomputed from the database rather than taken from the form. The client
  // sends only the code; the amount is never something it gets to name.
  if (parsed.data.discountCode) {
    const applied = await resolveDiscountForCart({
      code: parsed.data.discountCode,
      cart,
      shippingCents,
      userId: session?.user.id ?? null,
      email: parsed.data.email,
    });

    // A code that has expired between the preview and the submit stops the
    // order rather than silently charging full price — the buyer agreed to a
    // total, and quietly taking more is the worst possible resolution.
    if (!applied.ok) return { ok: false, message: applied.message };

    discountCents = applied.amountCents;
    shippingCents = Math.max(0, shippingCents - applied.shippingDiscountCents);
    redeeming = {
      id: applied.discountId,
      code: applied.code,
      amountCents: applied.amountCents + applied.shippingDiscountCents,
    };
  }

  const result = await placeOrder({
    cartId,
    buyerId: session?.user.id ?? null,
    email: parsed.data.email,
    shippingAddress: parsed.data.shippingAddress,
    currency: CURRENCY,
    shippingCents,
    discountCents,
    discount: redeeming,
    commissionBps: settings.commissionBps,
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
