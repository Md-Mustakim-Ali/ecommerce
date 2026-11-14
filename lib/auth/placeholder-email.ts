/**
 * Placeholder addresses for phone-only accounts.
 *
 * `user.email` is NOT NULL and UNIQUE in Better Auth's own schema, so someone
 * registering with a number alone still needs something in that column.
 * `.invalid` is reserved by RFC 2606 and can never resolve, which is the
 * point: a placeholder on a real domain would eventually be mailed, and mail
 * to a stranger's address is how a receipt containing someone's home address
 * ends up with the wrong person.
 *
 * Its own module rather than living in lib/auth/index.ts, because lib/orders/
 * claim.ts needs `isPlaceholderEmail` and the auth config imports claim.ts —
 * putting it there would be a cycle.
 */

const PLACEHOLDER_EMAIL_DOMAIN = "phone.invalid";

export function placeholderEmailFor(phone: string): string {
  return `${phone}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}

/**
 * Whether this address is a stand-in for a phone-only account, not a real one.
 *
 * Callers use it to refuse three things: sending mail to it, verifying it, and
 * — most importantly — claiming orders by it. Nobody ever placed an order with
 * a placeholder address, but a bug that matched them would attach every
 * phone-only account's orders to whichever one shared the number.
 */
export function isPlaceholderEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
}
