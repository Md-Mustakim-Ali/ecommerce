import { NextResponse } from "next/server";
import { z } from "zod";
import { placeOrderAction } from "@/lib/actions/checkout";
import { addLine } from "@/lib/cart";

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
  email: z.email(),
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
      shippingAddress: {
        recipientName: "Load Test",
        line1: "1 Test Street",
        city: "Testville",
        postalCode: "12345",
        countryCode: "US",
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
