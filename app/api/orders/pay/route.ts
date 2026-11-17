import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { orderPath } from "@/lib/orders/access";
import { claimantFrom, orderBelongsTo } from "@/lib/orders/ownership";
import { resumePayment } from "@/lib/payments/jomma/resume";

/**
 * "Pay for this order" — the one route that means it.
 *
 * Reached from the button on the order page and from the link in the email
 * sent after confirmation, deliberately the same URL for both. A buyer who
 * part-paid, closed the tab and came back a day later should not have to work
 * out which of two flows they are in; there is one place that answers "what do
 * I still owe and where do I send it", and this is it.
 *
 * Guests and signed-in buyers use it identically. Ownership is the same rule as
 * everywhere else — an account, a signed `?t=`, or the contact the order was
 * placed with.
 *
 * A GET that can create a payment intent, which is worth being uneasy about.
 * The mitigations: it is reachable only by somebody who already proved they own
 * this order, it is idempotent in the way that matters — a live intent is
 * handed back rather than replaced, so pressing it twice cannot leave a buyer
 * holding two reference codes — and it moves no money. Jomma's pay page does
 * that, and only the webhook records it.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicUrl(path: string): URL {
  // The public origin, never `request.url`: behind Render's proxy the request
  // arrives as http://localhost:10000. See app/api/orders/confirm/route.ts.
  return new URL(path, (process.env.BETTER_AUTH_URL ?? "").replace(/\/$/, ""));
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const orderId = params.get("id");
  const token = params.get("t");

  if (!orderId) return NextResponse.redirect(publicUrl("/"));

  const [order] = await db
    .select({
      id: orders.id,
      buyerId: orders.buyerId,
      email: orders.email,
      contactPhone: orders.contactPhone,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  const session = await getSession();

  // Same answer for "no such order" and "not yours". A uuid is not
  // authorisation, and telling a stranger which of their guesses exist is the
  // whole value of walking them.
  if (!order || !orderBelongsTo(order, claimantFrom(session, token))) {
    return NextResponse.redirect(publicUrl("/orders/expired?reason=bad-token"));
  }

  const resumed = await resumePayment(order.id);

  if (resumed.kind === "pay") return NextResponse.redirect(resumed.payUrl);

  /*
    Nothing to pay, for one of several reasons, and the order page says which:
    it is already covered, it settles on delivery, it was cancelled, or the day
    they had to pay has passed. Sending them there rather than rendering an
    error keeps the answer next to the amounts it refers to.
  */
  const url = publicUrl(orderPath(order.id));
  if (resumed.kind === "unavailable")
    url.searchParams.set("pay", "unavailable");
  else url.searchParams.set("pay", resumed.reason);

  return NextResponse.redirect(url);
}
