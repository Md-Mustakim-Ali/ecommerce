import { allocateProportionally } from "@/lib/money/allocate";

/**
 * Discount evaluation.
 *
 * Pure, so the rules can be tested exhaustively rather than through checkout
 * fixtures. Money is the place where "probably right" is not good enough, and
 * a discount is the one number on a checkout page the buyer will check by hand.
 *
 * Two decisions run through everything here:
 *
 * A store code only discounts that store's lines. Letting one seller's coupon
 * come off another seller's revenue is a payout dispute waiting to happen, and
 * it is invisible until the money moves.
 *
 * The discount is allocated back across the lines it applies to, in integer
 * minor units, summing exactly to the total taken off. A discount that exists
 * only as an order-level number cannot be split across sub-orders, which means
 * it cannot be charged to the right seller.
 */

export type DiscountDefinition = {
  id: string;
  code: string;
  scope: "platform" | "store";
  storeId: string | null;
  kind: "percentage" | "fixed_amount" | "free_shipping";
  /** Basis points for percentage, minor units for fixed_amount. */
  value: number;
  maxDiscountCents: number | null;
  minSubtotalCents: number;
  maxRedemptions: number | null;
  redemptionCount: number;
  perCustomerLimit: number | null;
  status: "draft" | "published" | "archived";
  startsAt: Date | null;
  endsAt: Date | null;
};

export type DiscountLine = {
  /** Anything that identifies the line to the caller. */
  id: string;
  storeId: string;
  lineTotalCents: number;
};

export type DiscountRejection =
  | "not-found"
  | "not-active"
  | "not-started"
  | "expired"
  | "fully-redeemed"
  | "customer-limit"
  | "below-minimum"
  | "nothing-eligible";

export type DiscountOutcome =
  | {
      ok: true;
      discountId: string;
      code: string;
      /** Total taken off the items. Zero for a free-shipping code. */
      amountCents: number;
      /** Shipping taken off. Zero unless the code is free_shipping. */
      shippingDiscountCents: number;
      /** Per-line allocation, summing exactly to amountCents. */
      perLine: { id: string; storeId: string; amountCents: number }[];
      /** Per-store totals, for splitting across sub-orders. */
      perStore: Record<string, number>;
      label: string;
    }
  | { ok: false; reason: DiscountRejection; message: string };

const MESSAGES: Record<DiscountRejection, string> = {
  "not-found": "That code is not recognised.",
  "not-active": "That code is not active.",
  "not-started": "That code has not started yet.",
  expired: "That code has expired.",
  "fully-redeemed": "That code has been fully claimed.",
  "customer-limit": "You have already used that code.",
  "below-minimum": "Your order is below the minimum for that code.",
  "nothing-eligible": "That code does not apply to anything in your cart.",
};

function reject(reason: DiscountRejection): DiscountOutcome {
  return { ok: false, reason, message: MESSAGES[reason] };
}

/**
 * Evaluates a code against a cart.
 *
 * `now` is injected rather than read from the clock so the scheduling window
 * is testable without freezing time globally.
 */
export function applyDiscount(input: {
  discount: DiscountDefinition;
  lines: readonly DiscountLine[];
  shippingCents: number;
  /** How many times this specific customer has already used this code. */
  customerRedemptions: number;
  now?: Date;
}): DiscountOutcome {
  const { discount, lines, shippingCents } = input;
  const now = input.now ?? new Date();

  if (discount.status !== "published") return reject("not-active");
  if (discount.startsAt && now < discount.startsAt)
    return reject("not-started");
  if (discount.endsAt && now > discount.endsAt) return reject("expired");

  if (
    discount.maxRedemptions !== null &&
    discount.redemptionCount >= discount.maxRedemptions
  ) {
    return reject("fully-redeemed");
  }

  if (
    discount.perCustomerLimit !== null &&
    input.customerRedemptions >= discount.perCustomerLimit
  ) {
    return reject("customer-limit");
  }

  // A store code only sees that store's lines. This is the whole reason the
  // eligible subtotal is computed before the minimum is checked rather than
  // after: "spend $50 at my store" must mean $50 at that store, not $50 across
  // a cart that happens to contain $5 of theirs.
  const eligible =
    discount.scope === "store" && discount.storeId
      ? lines.filter((line) => line.storeId === discount.storeId)
      : [...lines];

  if (eligible.length === 0) return reject("nothing-eligible");

  const eligibleSubtotal = eligible.reduce(
    (sum, line) => sum + line.lineTotalCents,
    0,
  );

  if (eligibleSubtotal < discount.minSubtotalCents) {
    return reject("below-minimum");
  }
  if (eligibleSubtotal <= 0) return reject("nothing-eligible");

  if (discount.kind === "free_shipping") {
    return {
      ok: true,
      discountId: discount.id,
      code: discount.code,
      amountCents: 0,
      shippingDiscountCents: shippingCents,
      perLine: eligible.map((line) => ({
        id: line.id,
        storeId: line.storeId,
        amountCents: 0,
      })),
      perStore: {},
      label: "Free shipping",
    };
  }

  let amount =
    discount.kind === "percentage"
      ? // Basis points, floored. Flooring favours the platform on the
        // fractional cent, which is the conservative direction — the
        // alternative is discounting a cent more than was authorised.
        Math.floor((eligibleSubtotal * discount.value) / 10_000)
      : discount.value;

  if (discount.maxDiscountCents !== null) {
    amount = Math.min(amount, discount.maxDiscountCents);
  }
  // A discount can never exceed what is being discounted, or the order total
  // goes negative and the payment provider rejects it.
  amount = Math.min(amount, eligibleSubtotal);
  amount = Math.max(0, amount);

  // Split proportionally across the eligible lines, largest-remainder, so the
  // parts sum to exactly the whole. Every seller is then charged their share.
  const shares = allocateProportionally(
    amount,
    eligible.map((line) => line.lineTotalCents),
  );

  const perLine = eligible.map((line, index) => ({
    id: line.id,
    storeId: line.storeId,
    amountCents: shares[index],
  }));

  const perStore: Record<string, number> = {};
  for (const line of perLine) {
    perStore[line.storeId] = (perStore[line.storeId] ?? 0) + line.amountCents;
  }

  return {
    ok: true,
    discountId: discount.id,
    code: discount.code,
    amountCents: amount,
    shippingDiscountCents: 0,
    perLine,
    perStore,
    label:
      discount.kind === "percentage"
        ? `${(discount.value / 100).toFixed(discount.value % 100 === 0 ? 0 : 2)}% off`
        : "Discount",
  };
}

/** Codes are matched upper-case; nobody types the capitalisation from an email. */
export function normaliseCode(input: string): string {
  return input.trim().toUpperCase();
}
