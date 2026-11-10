"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/lib/auth/guards";
import { getCart, getOrCreateCartId } from "@/lib/cart";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { resolveDiscountForCart } from "@/lib/discounts/resolve";
import { env } from "@/lib/env";
import { PLATFORM_CURRENCY } from "@/lib/money/currency";
import { placeOrder } from "@/lib/orders/create";
import { paymentProvider } from "@/lib/payments";
import { jommaConfigured } from "@/lib/payments/jomma/client";
import { startPayment } from "@/lib/payments/jomma/intents";
import { paymentMethods } from "@/lib/payments/methods";
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

/** Bangladeshi mobile: 11 digits, 01, then an operator prefix of 3–9. */
const BD_MOBILE = /^01[3-9]\d{8}$/;

const addressSchema = z
  .object({
    recipientName: z.string().trim().min(1, "Enter a name").max(120),
    /**
     * Required. A courier who cannot telephone the recipient cannot deliver,
     * and a failed delivery costs the seller the parcel and the buyer the
     * order — so this is worth blocking checkout over rather than discovering
     * on the doorstep.
     *
     * This is the delivery number and nothing else. It is deliberately not
     * sent to Jomma as the payer's number; see the note in the intent call
     * below for why guessing there is worse than not knowing.
     */
    phone: z.string().trim().min(1, "Enter a phone number").max(40),
    line1: z.string().trim().min(1, "Enter an address").max(200),
    line2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(1, "Enter a city").max(120),
    region: z.string().trim().max(120).optional(),
    postalCode: z.string().trim().min(1, "Enter a postcode").max(40),
    countryCode: z.string().trim().length(2, "Use a 2-letter country code"),
  })
  .superRefine((address, ctx) => {
    // Format-checked only for Bangladesh, because that is the only country
    // whose numbering plan this shop can claim to know. Applying a BD pattern
    // to every address would reject perfectly good foreign numbers, and
    // accepting anything at all would let "0171" through to a courier as
    // though it were a phone number.
    if (address.countryCode.toUpperCase() !== "BD") return;

    // Spaces and dashes are how people actually type a number; strip the
    // formatting before judging it rather than making the buyer guess our
    // preferred punctuation. +880 is the same number written for abroad.
    const digits = address.phone.replace(/[\s-]/g, "").replace(/^\+?880/, "0");

    if (!BD_MOBILE.test(digits)) {
      ctx.addIssue({
        code: "custom",
        path: ["phone"],
        message: "Enter a valid mobile number, like 01712345678.",
      });
    }
  });

const checkoutSchema = z.object({
  email: z.email("Enter a valid email"),
  shippingAddress: addressSchema,
  /** Optional. Re-evaluated here; the browser's figure is never trusted. */
  discountCode: z.string().trim().max(60).optional(),
  paymentMethod: z.enum(paymentMethods).default("manual"),
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

const CURRENCY = PLATFORM_CURRENCY;

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

  // ── bKash / Nagad, via Jomma ───────────────────────────────────────────
  //
  // A separate branch rather than another PaymentProvider adapter, and that is
  // a deliberate call. The port in lib/payments/provider.ts models a processor
  // that moves money: it has refund(), and its webhook vocabulary is
  // succeeded/failed/refunded. Jomma moves nothing — it watches a phone and
  // reports what it saw — so it has no refund rails at all, and three of its
  // six payment events (partial, overpaid, reversed) have nowhere to go in
  // that vocabulary. Implementing refund() against it would be a lie the type
  // system would happily accept.
  const method = parsed.data.paymentMethod;
  if (method !== "manual") {
    if (!jommaConfigured()) {
      return {
        ok: false,
        message: "That payment method is not available right now.",
      };
    }

    const started = await startPayment({
      orderId: result.orderId,
      orderNumber: result.orderNumber,
      // Poisha. The platform currency is BDT and every *_cents column is
      // already minor units, so this is a pass-through, not a conversion —
      // which is the entire reason the shop was switched to BDT rather than
      // converting per order.
      amountMinorUnits: result.totalCents,
      provider: method === "any" ? "any" : method,
      // ── Deliberately not sending the checkout phone ──────────────────────
      //
      // It is tempting, because Jomma matches faster with a declared sender.
      // But the number collected at checkout is a *delivery* number, and the
      // number money arrives from is the *payer's*. A parcel going to a
      // recipient paid for by somebody else is an ordinary Bangladeshi
      // transaction, not an edge case.
      //
      // What makes sending it actively wrong rather than merely imprecise is
      // how Jomma treats a populated payerMsisdn: pay-page.ts derives
      // `payerKnown: Boolean(row.payerMsisdn)` and the pay client skips the
      // step that asks. So a delivery number sent here does not become a hint
      // Jomma might check — it becomes the answer, unasked, and every payment
      // from a different handset then fails to auto-match while looking
      // correctly configured from both sides.
      //
      // Null instead, so the pay page asks the buyer, who is the only party
      // that knows. Jomma is being changed to pre-fill this from the order and
      // ask the buyer to confirm it; once that ships, pass the phone here
      // again — the value is genuinely useful as a *suggestion*.
      payerMsisdn: null,
      returnUrl: absoluteUrl(`/orders/${result.orderId}?awaiting=1`),
      cancelUrl: absoluteUrl("/cart"),
      attempt: 1,
    });

    if (!started.ok) {
      // The order exists and is holding stock. Left pending on purpose: the
      // buyer can retry from the order page, and Jomma's TTL releases it
      // otherwise. Silently cancelling here would lose a recoverable sale.
      return { ok: false, message: started.message };
    }

    await db
      .update(orders)
      .set({ paymentIntentId: started.intentId })
      .where(eq(orders.id, result.orderId));

    revalidatePath("/account/orders");

    return {
      ok: true,
      orderId: result.orderId,
      orderNumber: result.orderNumber,
      redirectUrl: started.payUrl,
      // Nothing about landing back on returnUrl means paid. Only the webhook
      // moves this order, which is why the buyer lands on a waiting page.
      settlesOffline: false,
    };
  }

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

/**
 * Absolute URLs for Jomma's redirects.
 *
 * They must be absolute — the hosted pay page is on another origin — and they
 * are checked against the hostnames registered under Apps → Hosted checkout.
 * An app with none registered gets no redirect at all rather than any redirect
 * it asks for, so BETTER_AUTH_URL's host has to be registered there. See
 * docs/jomma.md.
 */
function absoluteUrl(path: string): string {
  return new URL(path, env.BETTER_AUTH_URL).toString();
}
