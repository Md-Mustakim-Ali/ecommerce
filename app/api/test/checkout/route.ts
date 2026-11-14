import { NextResponse } from "next/server";
import { z } from "zod";
import { placeOrderAction } from "@/lib/actions/checkout";
import { addLine } from "@/lib/cart";
import { paymentMethods } from "@/lib/payments/methods";

/**
 * A checkout in one request, for the load test.
 *
 * Exists because driving a server action over HTTP means reproducing the
 * framework's own encoding by hand, which breaks on every framework upgrade
 * and tests the encoding rather than the checkout. This endpoint calls the
 * same `placeOrderAction` a browser calls, through the same session, cart
 * cookie, rate limiter and transaction — so what it measures is real.
 *
 * Refuses outside development, at the top, before parsing anything. An
 * endpoint that places an order without a payment is one that empties the
 * warehouse if it ever ships. `next build` also drops it from the route
 * manifest in production only if the guard runs first, so the guard is the
 * first statement in the handler and not a condition further down.
 */

const schema = z.object({
  variantId: z.uuid(),
  /**
   * Optional since a buyer may check out with a number instead.
   *
   * Both contacts are exposed here rather than only email, because
   * "phone-only order, then claimed by an account" is a path that cannot be
   * exercised any other way without reimplementing the server action's
   * encoding by hand — the same reason this endpoint exists at all.
   */
  email: z.email().optional(),
  contactPhone: z.string().trim().max(40).optional(),
  /**
   * Defaults to the offline path, which is what the load test wants — it
   * measures our own checkout rather than a round trip to Jomma.
   *
   * Set it to bkash or nagad to exercise the mobile-money branch, which is the
   * only way to reach startPayment() through the real action rather than by
   * reimplementing it in a script.
   */
  paymentMethod: z.enum(paymentMethods).default("manual"),
  /**
   * The delivery number. Optional here and defaulted below, because the load
   * test does not send one and its point is to measure checkout rather than to
   * exercise validation.
   */
  phone: z.string().trim().max(40).optional(),
  /**
   * Exposed for the same reason the contacts are: a redemption is now recorded
   * against whichever contact the buyer gave, and the per-customer limit has
   * to keep counting when that contact is a number rather than an address.
   * Neither is reachable without going through the real action.
   */
  discountCode: z.string().trim().max(60).optional(),
});

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    // The real cart path, so the stock check and the cart cookie behave
    // exactly as they do for a shopper.
    await addLine(parsed.data.variantId, 1);

    const result = await placeOrderAction({
      email: parsed.data.email,
      contactPhone: parsed.data.contactPhone,
      discountCode: parsed.data.discountCode,
      paymentMethod: parsed.data.paymentMethod,
      shippingAddress: {
        recipientName: "Load Test",
        // A valid Bangladeshi mobile, because the address below says BD and
        // checkout now rejects anything that a courier could not ring.
        phone: parsed.data.phone ?? "01712345678",
        line1: "1 Test Street",
        city: "Testville",
        postalCode: "12345",
        countryCode: "BD",
      },
    });

    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "failed" },
      { status: 500 },
    );
  }
}
