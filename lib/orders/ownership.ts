import { isPlaceholderEmail } from "@/lib/auth/placeholder-email";
import { normaliseBdMobile } from "@/lib/validation/phone";

/**
 * Whether an order belongs to whoever is asking.
 *
 * One rule, in one place, because four callers had grown their own copy of it —
 * the order page, the invoice, the demo payment action and the payment status
 * poll. They must agree: a uuid is not authorisation, and a rule that is
 * stricter in one of them than the others is a buyer who can see their order
 * but not download its invoice.
 *
 * Ownership is one of three things, any of which is enough:
 *
 * - the account it is attached to, which is what claiming sets;
 * - the email it was placed with, so a guest can open theirs from the receipt
 *   link before they have an account at all;
 * - the phone it was placed with, the same courtesy for a buyer who checked
 *   out with a number and no address.
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
    buyerId: string | null;
    email: string | null;
    contactPhone: string | null;
  },
  claimant: {
    userId?: string | null;
    email?: string | null;
    phone?: string | null;
  },
): boolean {
  if (claimant.userId && order.buyerId === claimant.userId) return true;

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
