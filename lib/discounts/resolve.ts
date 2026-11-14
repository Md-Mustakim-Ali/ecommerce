import { and, eq, or, sql } from "drizzle-orm";
import type { CartSummary } from "@/lib/cart";
import { db } from "@/lib/db";
import { discountCodes, discountRedemptions } from "@/lib/db/schema";
import { applyDiscount, type DiscountOutcome, normaliseCode } from "./apply";

/**
 * Looks a code up and evaluates it against a cart.
 *
 * Shared by the checkout preview and by order placement, so the number shown
 * and the number charged come from one piece of code. Two implementations of
 * "what is this code worth" is how a buyer ends up agreeing to one total and
 * being charged another.
 */
export async function resolveDiscountForCart(input: {
  code: string;
  cart: CartSummary;
  shippingCents: number;
  userId: string | null;
  email: string | null;
  /** Canonical `01XXXXXXXXX`. Null when the buyer gave only an email. */
  phone?: string | null;
}): Promise<DiscountOutcome> {
  const code = normaliseCode(input.code);

  const [found] = await db
    .select()
    .from(discountCodes)
    .where(sql`upper(${discountCodes.code}) = ${code}`)
    .limit(1);

  if (!found) {
    return {
      ok: false,
      reason: "not-found",
      message: "That code is not recognised.",
    };
  }

  const customerRedemptions = await countRedemptions(found.id, input);

  return applyDiscount({
    discount: {
      id: found.id,
      code: found.code,
      scope: found.scope,
      storeId: found.storeId,
      kind: found.kind,
      value: found.value,
      maxDiscountCents: found.maxDiscountCents,
      minSubtotalCents: found.minSubtotalCents,
      maxRedemptions: found.maxRedemptions,
      redemptionCount: found.redemptionCount,
      perCustomerLimit: found.perCustomerLimit,
      status: found.status,
      startsAt: found.startsAt,
      endsAt: found.endsAt,
    },
    lines: input.cart.lines.map((line) => ({
      id: line.itemId,
      storeId: line.storeId,
      lineTotalCents: line.lineTotalCents,
    })),
    shippingCents: input.shippingCents,
    customerRedemptions,
  });
}

/**
 * How many times this person has already used a code.
 *
 * Matched on account when signed in, and on whichever contacts they gave
 * otherwise: a guest has no account to count against, so the contact is the
 * only thing that carries between orders.
 *
 * Either contact matching is enough, which is deliberately the generous
 * reading in the buyer's favour — two guest checkouts sharing a phone are the
 * same person even when the addresses differ.
 */
export async function countRedemptions(
  discountId: string,
  who: { userId: string | null; email: string | null; phone?: string | null },
): Promise<number> {
  const email = who.email?.trim().toLowerCase() || null;
  const phone = who.phone?.trim() || null;

  if (!who.userId && !email && !phone) return 0;

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(discountRedemptions)
    .where(
      and(
        eq(discountRedemptions.discountId, discountId),
        who.userId
          ? eq(discountRedemptions.userId, who.userId)
          : or(
              email
                ? sql`lower(${discountRedemptions.email}) = ${email}`
                : undefined,
              phone ? eq(discountRedemptions.contactPhone, phone) : undefined,
            ),
      ),
    );

  return row?.count ?? 0;
}
