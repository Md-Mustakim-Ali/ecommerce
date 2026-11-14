// Relative, not "@/lib/...": lib/auth/index.ts imports this file, and the
// `auth` CLI loads that through jiti, which does not resolve tsconfig path
// aliases. Keep these relative or `pnpm auth:generate` breaks.
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { isPlaceholderEmail } from "../auth/placeholder-email";
import { db } from "../db";
import { orders, user } from "../db/schema";
import { log } from "../observability/logger";
import { normaliseBdMobile } from "../validation/phone";

/**
 * Attaching a guest's past orders to the account they just made.
 *
 * The buyer does nothing. They verify a contact — which they had to do anyway —
 * and every order placed with that contact is theirs, with its addresses,
 * payments and messages intact.
 *
 * Three rules hold this together, and all three are load-bearing:
 *
 * 1. **Verified contacts only.** Every caller is a post-verification hook. An
 *    unverified contact proves someone can type an address or a number, not
 *    that they hold it, and an order history is most of what an account is
 *    worth stealing.
 *
 * 2. **Unclaimed orders only.** `buyer_id IS NULL` is in the WHERE clause, so
 *    an order that already belongs to somebody can never be moved. Without it,
 *    two accounts verifying the same recycled number would take orders off
 *    each other — and BD operators do recycle numbers.
 *
 * 3. **The FK moves, nothing is copied.** Claiming sets `orders.buyer_id`. The
 *    order row, its sub-orders, items and notes are untouched, so there is
 *    exactly one copy of an order no matter how many contacts point at it, and
 *    order history stays a single indexed read on `buyer_id`.
 */

export type ClaimResult = { claimed: number };

/**
 * Claims every unclaimed order matching a contact this user has just verified.
 *
 * Both contacts may be passed at once — an account that verified an address and
 * a number gets the union in one statement, which is the "he used email on one
 * order and phone on another" case.
 */
export async function claimOrdersForContact(input: {
  userId: string;
  email?: string | null;
  phone?: string | null;
}): Promise<ClaimResult> {
  // Matched the way they are stored. Email is compared case-insensitively
  // because nobody types their own address the same way twice; the phone is
  // reduced to the canonical 01XXXXXXXXX first, so "+880 171 234 5678" on the
  // order and "01712345678" on the account are the same buyer.
  const email = input.email?.trim().toLowerCase() || null;
  const phone = input.phone ? normaliseBdMobile(input.phone) : null;

  if (!email && !phone) return { claimed: 0 };

  const matchesContact = or(
    email ? sql`lower(${orders.email}) = ${email}` : undefined,
    phone ? eq(orders.contactPhone, phone) : undefined,
  );

  const claimed = await db
    .update(orders)
    .set({ buyerId: input.userId })
    .where(and(isNull(orders.buyerId), matchesContact))
    .returning({ id: orders.id });

  if (claimed.length > 0) {
    // Worth a line. If a claim ever attaches an implausible number of orders,
    // this is the record that says which account and which contact did it.
    log.info("guest orders claimed", {
      userId: input.userId,
      byEmail: Boolean(email),
      byPhone: Boolean(phone),
      count: claimed.length,
    });
  }

  return { claimed: claimed.length };
}

/**
 * Every verified contact this account holds, for a claim sweep.
 *
 * Used when the set of verified contacts may have changed without a
 * verification hook firing — an account that added a second contact, or a
 * backfill after the claim rules changed. Reads the account rather than
 * trusting a caller to say what is verified.
 */
export async function claimOrdersForUser(userId: string): Promise<ClaimResult> {
  const [account] = await db
    .select({
      email: user.email,
      emailVerified: user.emailVerified,
      phoneNumber: user.phoneNumber,
      phoneNumberVerified: user.phoneNumberVerified,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  if (!account) return { claimed: 0 };

  return claimOrdersForContact({
    userId,
    email:
      account.emailVerified && !isPlaceholderEmail(account.email)
        ? account.email
        : null,
    phone: account.phoneNumberVerified ? account.phoneNumber : null,
  });
}
