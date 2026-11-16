import { isPlaceholderEmail } from "@/lib/auth/placeholder-email";
import { normaliseBdMobile } from "@/lib/validation/phone";
import { verifyOrderAccess } from "./access";

/**
 * Whether an order belongs to whoever is asking.
 *
 * One rule, in one place, because four callers had grown their own copy of it —
 * the order page, the invoice, the demo payment action and the payment status
 * poll. They must agree: a uuid is not authorisation, and a rule that is
 * stricter in one of them than the others is a buyer who can see their order
 * but not download its invoice.
 *
 * Ownership is one of four things, any of which is enough:
 *
 * - the account it is attached to, which is what claiming sets;
 * - a signed access token for this order, which is what the receipt link and
 *   the redirect out of checkout carry — see lib/orders/access.ts. This is the
 *   one guests actually arrive with, since a guest has no session and the page
 *   has no way to learn their address;
 * - the email it was placed with, so a signed-in buyer sees an order placed
 *   before they had an account;
 * - the phone it was placed with, the same for a buyer who checked out with a
 *   number and no address.
 *
 * The contact comparison is not a security boundary on its own — it is the
 * "guest opening their own confirmation" path, and it only ever runs against a
 * contact the caller has already proven it holds (a session's own address, or
 * a number typed into a lookup form that rate limits). Attaching an order to
 * an *account* is a stronger act and requires verification; see
 * lib/orders/claim.ts.
 */
export function orderBelongsTo(
  order: {
    id?: string;
    buyerId: string | null;
    email: string | null;
    contactPhone: string | null;
  },
  claimant: {
    userId?: string | null;
    email?: string | null;
    phone?: string | null;
    /** The `?t=` from the URL. Checked against this order id, never any other. */
    accessToken?: string | null;
  },
): boolean {
  if (claimant.userId && order.buyerId === claimant.userId) return true;

  if (order.id && verifyOrderAccess(order.id, claimant.accessToken))
    return true;

  if (
    claimant.email &&
    order.email &&
    order.email.trim().toLowerCase() === claimant.email.trim().toLowerCase()
  ) {
    return true;
  }

  // Both sides canonicalised, so a number typed as "+8801712345678" matches
  // the "01712345678" the order was stored with.
  if (claimant.phone && order.contactPhone) {
    const asked = normaliseBdMobile(claimant.phone);
    if (asked !== null && asked === order.contactPhone) return true;
  }

  return false;
}

/**
 * The contacts a signed-in account can be recognised by.
 *
 * A phone-only account carries a placeholder address it never chose and can
 * never receive mail at, so that one is dropped: matching on it would let two
 * such accounts recognise each other's orders if a placeholder were ever
 * written onto one.
 */
export function contactsFromSession(session: {
  user: { id: string; email: string; phoneNumber?: string | null };
}): { userId: string; email: string | null; phone: string | null } {
  return {
    userId: session.user.id,
    email: isPlaceholderEmail(session.user.email) ? null : session.user.email,
    phone: session.user.phoneNumber ?? null,
  };
}

/**
 * The claimant behind a request that may not have a session at all.
 *
 * The order page and the invoice already worked this out for themselves; the
 * two server actions did not, and both opened with "no session, no answer".
 * That is wrong now that guests can pay: a guest's own order page authorises
 * them by token, renders the waiting card, and then the poll behind that card
 * refused them — so a guest who really had paid watched "Please sign in" while
 * the money sat applied against their order.
 *
 * A token is the only credential a guest has. It is signed for one order id and
 * checked against that id alone, so passing it here grants nothing wider than
 * the page it was already good for.
 */
export function claimantFrom(
  session: Parameters<typeof contactsFromSession>[0] | null | undefined,
  accessToken?: string | null,
): {
  userId?: string | null;
  email?: string | null;
  phone?: string | null;
  accessToken?: string | null;
} {
  return session
    ? { ...contactsFromSession(session), accessToken }
    : { accessToken };
}
