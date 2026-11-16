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

/**
 * The public origin, NOT `request.url`.
 *
 * Behind Render's proxy the request arrives at the container as
 * `http://localhost:10000/...`, so `new URL(path, request.url)` resolved
 * against localhost and every confirmation link redirected the buyer to a dead
 * address on their own machine. The order was confirmed and the page they
 * landed on did not exist.
 *
 * BETTER_AUTH_URL is the canonical public origin and is already required to be
 * exact — Better Auth compares request origins against it — so it is the one
 * value that cannot quietly be the internal one.
 */
function publicUrl(path: string): URL {
  return new URL(path, (process.env.BETTER_AUTH_URL ?? "").replace(/\/$/, ""));
}

function fail(reason: string) {
  // Deliberately vague and deliberately not a 404 page: the buyer here is
  // somebody whose link expired or was mangled by a mail client, and the only
  // useful thing to do is tell them so where they can read it.
  const url = publicUrl("/orders/expired");
  url.searchParams.set("reason", reason);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const orderId = params.get("id");
  const token = params.get("t") ?? undefined;

  if (!orderId) return fail("missing");

  const result = await confirmOrder(orderId, token);

  if (!result.ok) return fail(result.reason);

  return NextResponse.redirect(publicUrl(confirmedPath(result.orderId)));
}
