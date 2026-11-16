import { NextResponse } from "next/server";
import { confirmedPath, confirmOrder } from "@/lib/orders/confirmation";

/**
 * The link a guest follows to prove the contact they checked out with.
 *
 * A GET that changes state, which is normally a smell — but this is an email
 * link, and an email link is a GET. The mitigations are that it does nothing
 * without a valid HMAC for that specific order, and that following it twice is
 * idempotent: the second click sees a confirmed order and lands on the same
 * page rather than reporting an error at somebody who did nothing wrong.
 *
 * It redirects rather than rendering. The buyer wants to see their order, not
 * a page that says a thing happened, and the order page is where every other
 * route in this flow already sends them.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(request: Request, reason: string) {
  // Deliberately vague and deliberately not a 404 page: the buyer here is
  // somebody whose link expired or was mangled by a mail client, and the only
  // useful thing to do is tell them so where they can read it.
  const url = new URL("/orders/expired", request.url);
  url.searchParams.set("reason", reason);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const orderId = params.get("id");
  const token = params.get("t") ?? undefined;

  if (!orderId) return fail(request, "missing");

  const result = await confirmOrder(orderId, token);

  if (!result.ok) return fail(request, result.reason);

  return NextResponse.redirect(
    new URL(confirmedPath(result.orderId), request.url),
  );
}
