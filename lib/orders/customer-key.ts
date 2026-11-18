/**
 * Deciding that two orders came from the same person.
 *
 * ── There is no customers table, and that is the whole problem ───────────
 *
 * Orders carry three ways of naming a buyer and any of them may be absent: an
 * account id when they were signed in, an email, a phone. A "customer" is
 * therefore something derived, not something stored, and this is the rule that
 * derives it.
 *
 * The order of preference is the order of certainty:
 *
 *   1. `buyerId` — an account. Two orders on one account are one person, and
 *      claiming a guest order sets this, so history folds in by itself.
 *   2. email — proved, because a guest cannot place an order without following
 *      the link sent to it.
 *   3. phone — the same, once SMS verification exists.
 *
 * ── The limitation, stated rather than hidden ────────────────────────────
 *
 * Somebody who orders once with an email and once with a phone and never signs
 * in appears as two customers. Nothing here can join those: no shared identity
 * was ever proved, and guessing — matching a name, or an address — would merge
 * two different people who live together, which is worse than showing one
 * person twice. Fixing it properly needs a real customer identity, and that is
 * a bigger change than this view.
 *
 * ── Why the key is encoded ───────────────────────────────────────────────
 *
 * It goes in a URL. An email contains `@` and `.`, and a raw one in a path
 * segment is both fragile and a contact detail sitting in browser history and
 * server logs. base64url keeps it to characters a path accepts. It is NOT a
 * secret and must never be treated as one — the pages that use it authorise on
 * the store, not on the key.
 */

export type CustomerIdentity = {
  buyerId: string | null;
  email: string | null;
  contactPhone: string | null;
};

/** `null` when an order names nobody, which the schema should prevent. */
export function customerKeyFor(order: CustomerIdentity): string | null {
  if (order.buyerId) return `u_${order.buyerId}`;

  const email = order.email?.trim().toLowerCase();
  if (email) return `e_${toBase64Url(email)}`;

  const phone = order.contactPhone?.trim();
  if (phone) return `p_${phone}`;

  return null;
}

export type ParsedCustomerKey =
  | { kind: "account"; buyerId: string }
  | { kind: "email"; email: string }
  | { kind: "phone"; phone: string }
  | null;

export function parseCustomerKey(key: string): ParsedCustomerKey {
  const value = key.slice(2);
  if (!value) return null;

  switch (key.slice(0, 2)) {
    case "u_":
      return { kind: "account", buyerId: value };
    case "e_": {
      const email = fromBase64Url(value);
      return email ? { kind: "email", email } : null;
    }
    case "p_":
      return { kind: "phone", phone: value };
    default:
      return null;
  }
}

/**
 * What to call this customer on screen.
 *
 * The recipient name is preferred because it is what a person answers to, and
 * a seller reading a list of addresses recognises "Afroza Sultana" long before
 * they recognise an email. Falls back through the contacts, and never renders
 * an empty string.
 */
export function customerLabel(input: {
  recipientName?: string | null;
  email: string | null;
  contactPhone: string | null;
}): string {
  return (
    input.recipientName?.trim() ||
    input.email?.trim() ||
    input.contactPhone?.trim() ||
    "Unknown"
  );
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string): string | null {
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    // Round-trip, so a mangled key cannot decode into some other address.
    return toBase64Url(decoded) === value ? decoded : null;
  } catch {
    return null;
  }
}
