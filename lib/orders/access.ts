import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Letting a guest open the order they just placed.
 *
 * Guest checkout has always been allowed, and the order page has always
 * refused guests — `/orders` sat in proxy.ts's protected prefixes, so a buyer
 * who was not signed in was redirected to sign-in the instant their order was
 * created, and the link in their receipt went to the same place. They paid and
 * then had nowhere to look.
 *
 * The rule that made that happen is still right: a uuid is not authorisation.
 * Order ids are uuidv7, which is *time-ordered* — knowing one tells you
 * roughly where its neighbours are, so "unguessable id" was never the defence
 * anyone assumed it was.
 *
 * So the link carries a capability instead. An HMAC over the order id, keyed
 * on BETTER_AUTH_SECRET: it proves the holder was given this URL by us, and it
 * is worthless for any other order.
 *
 * No expiry, deliberately. This is the link in a receipt, and receipts get
 * opened months later — a token that quietly stops working turns "where is my
 * order" into a support conversation. The exposure that buys is narrow: the
 * token unlocks one order, and it travels in the same email that already
 * contains that order's address and total. Anyone holding the link already had
 * the receipt.
 */

/** Kept short: this ends up in a URL that people paste into messages. */
const TOKEN_BYTES = 16;

/**
 * Read here rather than through lib/env, and read lazily.
 *
 * lib/env parses the whole environment at module load, so importing it would
 * make every test that touches an order — directly or through the four modules
 * that reach this one — need a full environment to start. No test in this
 * suite has ever needed one. The app still validates at boot, because lib/env
 * is imported by plenty of other modules; this one just does not depend on it.
 */
function secret(): string {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value) {
    throw new Error(
      "BETTER_AUTH_SECRET is required to sign order access links.",
    );
  }
  return value;
}

export function signOrderAccess(orderId: string): string {
  return createHmac("sha256", secret())
    .update(`order-access:${orderId}`)
    .digest("base64url")
    .slice(0, TOKEN_BYTES * 2);
}

/**
 * Constant-time, and total on malformed input.
 *
 * `timingSafeEqual` throws when the lengths differ, which on a comparison fed
 * straight from a query string is a 500 for anyone who types a short token.
 */
export function verifyOrderAccess(
  orderId: string,
  token: string | undefined | null,
): boolean {
  if (!token) return false;

  const expected = Buffer.from(signOrderAccess(orderId));
  const given = Buffer.from(token);
  if (expected.length !== given.length) return false;

  return timingSafeEqual(expected, given);
}

/** The path a receipt, a shipment notice or a redirect should point at. */
export function orderPath(orderId: string): string {
  return `/orders/${orderId}?t=${signOrderAccess(orderId)}`;
}
