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
import { isDeliverablePhone, normaliseBdMobile } from "@/lib/validation/phone";

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

const addressSchema = z
  .object({
    recipientName: z.string().trim().min(1, "Enter a name").max(120),
    /**
     * Required. A courier who cannot telephone the recipient cannot deliver,
     * and a failed delivery costs the seller the parcel and the buyer the
     * order — so this is worth blocking checkout over rather than discovering
     * on the doorstep.
     *
     * Primarily the delivery number. It is also offered to Jomma as a
     * *suggested* payer number — the buyer is asked to confirm it and can
     * replace it, so a parcel paid for by somebody else still settles.
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
    // The same helper the payment path uses to canonicalise the number it
    // sends to Jomma, so the two cannot drift into disagreeing about what
    // counts as a valid Bangladeshi mobile.
    if (isDeliverablePhone(address.phone, address.countryCode)) return;

    ctx.addIssue({
      code: "custom",
      path: ["phone"],
      message: "Enter a valid mobile number, like 01712345678.",
    });
  });

const checkoutSchema = z
  .object({
    /**
     * Contact details. At least one, never neither.
     *
     * Email stopped being mandatory when phone became an account identifier.
     * A buyer who does not use email was previously forced to invent an
     * address, which produced a receipt sent nowhere and a contact that
     * matches nothing — so the order could never be found again, by them or
     * by support.
     */
    email: z.union([z.email("Enter a valid email"), z.literal("")]).optional(),
    /**
     * The buyer's own number, not the courier's.
     *
     * `shippingAddress.phone` is where the parcel goes and is routinely
     * somebody else — the recipient. This is who bought it, and it is what
     * their account will claim this order by once they verify it.
     */
    contactPhone: z.string().trim().max(40).optional(),
    shippingAddress: addressSchema,
    /** Optional. Re-evaluated here; the browser's figure is never trusted. */
    discountCode: z.string().trim().max(60).optional(),
    paymentMethod: z.enum(paymentMethods).default("manual"),
  })
  .superRefine((input, ctx) => {
    const email = input.email?.trim() ?? "";
    const phone = input.contactPhone?.trim() ?? "";

    if (!email && !phone) {
      ctx.addIssue({
        code: "custom",
        path: ["email"],
        message: "Enter an email or a phone number so we can reach you.",
      });
      return;
    }

    // Only when one was given. An empty phone is a buyer who chose email,
    // not a buyer who typed their number wrong.
    if (phone && !normaliseBdMobile(phone)) {
      ctx.addIssue({
        code: "custom",
        path: ["contactPhone"],
        message: "Enter a valid mobile number, like 01712345678.",
      });
    }
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

  /**
   * Canonicalised once, here, and used for everything downstream.
   *
   * The buyer may have typed "+880 171 234 5678"; the account they make later
   * will hold "01712345678". Storing what was typed would mean an order that
   * never matches its own buyer — the claim would silently find nothing, which
   * is the worst kind of failure because the order simply never appears.
   *
   * Empty string is normalised to null so the check constraint sees the
   * absence rather than a blank that satisfies IS NOT NULL.
   */
  const contactEmail = parsed.data.email?.trim() || null;
  const contactPhone = parsed.data.contactPhone
    ? normaliseBdMobile(parsed.data.contactPhone)
    : null;

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
      email: contactEmail,
      phone: contactPhone,
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
    email: contactEmail,
    contactPhone,
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
      // ── A suggestion, since Jomma 1.4.19 ────────────────────────────────
      //
      // This was null for a while, and the reason is worth keeping. Jomma used
      // to treat a populated payerMsisdn as settled fact — `payerKnown` was a
      // plain Boolean over the column, and the pay page skipped the step that
      // asks. A delivery number sent here therefore became the answer without
      // anyone being asked, and payments from any other handset failed to
      // auto-match with nothing visibly wrong on either side.
      //
      // 1.4.19 records who supplied the number and asks the buyer to confirm
      // it, so the guess is now correctable by the only person who knows. That
      // makes sending it strictly better than not: payer_msisdn is worth 60
      // points to the matcher, and a confirmed one is the difference between
      // an order settling by itself and one sitting in manual review.
      //
      // Canonicalised first. The buyer may have typed "017 1234 5678" or
      // "+8801712345678", and Jomma validates against a bare 01XXXXXXXXX — so
      // sending what was typed would fail its check for a number that is
      // perfectly correct. Null for a non-Bangladeshi address, which is honest
      // rather than lossy: there is no BD mobile to suggest, and the pay page
      // asks as it did before.
      payerMsisdn: normaliseBdMobile(parsed.data.shippingAddress.phone),
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
    buyerEmail: contactEmail,
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
