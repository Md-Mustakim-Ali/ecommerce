import { allocateProportionally } from "./allocate";

/**
 * Order maths.
 *
 * Every value here is integer minor units. No floating point enters or leaves
 * this file, and every split is checked to sum back to its input.
 *
 * A cart holding items from three sellers becomes one payment and three
 * fulfilments, so shipping and any order-level discount have to be divided
 * across the sub-orders — and the parts must add up exactly to what the buyer
 * was charged, or the ledger will never reconcile.
 */

/** Basis points. 1000 = 10.00%. */
export const DEFAULT_COMMISSION_BPS = 1000;

export type CartLineInput = {
  variantId: string;
  storeId: string;
  unitPriceCents: number;
  quantity: number;
};

export type SubOrderTotals = {
  storeId: string;
  lines: (CartLineInput & { lineTotalCents: number })[];
  subtotalCents: number;
  shippingCents: number;
  discountCents: number;
  commissionCents: number;
  /** What the seller is owed: subtotal + shipping - discount - commission. */
  payoutCents: number;
};

export type OrderTotals = {
  subtotalCents: number;
  shippingCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  subOrders: SubOrderTotals[];
};

export function lineTotal(line: CartLineInput): number {
  return line.unitPriceCents * line.quantity;
}

/**
 * Commission on a sub-order.
 *
 * Rounded down, so a fractional cent always lands with the seller rather than
 * the platform. That is a deliberate, documented direction — an undocumented
 * rounding direction is how a marketplace ends up quietly skimming.
 */
export function commissionFor(amountCents: number, bps: number): number {
  if (!Number.isInteger(amountCents)) {
    throw new Error(
      `commissionFor needs integer minor units, got ${amountCents}`,
    );
  }
  if (bps < 0 || bps > 10_000) {
    throw new Error(`Commission bps out of range: ${bps}`);
  }
  if (amountCents <= 0) return 0;
  return Math.floor((amountCents * bps) / 10_000);
}

export function buildOrderTotals(input: {
  lines: CartLineInput[];
  /** Charged once for the whole order, then divided across stores. */
  shippingCents?: number;
  /** Order-level discount, as a positive number. */
  discountCents?: number;
  taxCents?: number;
  commissionBps?: number;
}): OrderTotals {
  const shippingCents = input.shippingCents ?? 0;
  const discountCents = input.discountCents ?? 0;
  const taxCents = input.taxCents ?? 0;
  const commissionBps = input.commissionBps ?? DEFAULT_COMMISSION_BPS;

  if (input.lines.length === 0) {
    throw new Error("Cannot build totals for an empty cart");
  }

  // Grouped in first-seen order so the result is stable for the same cart.
  const byStore = new Map<
    string,
    (CartLineInput & { lineTotalCents: number })[]
  >();
  for (const line of input.lines) {
    if (!Number.isInteger(line.unitPriceCents)) {
      throw new Error(
        `Line price must be integer minor units: ${line.unitPriceCents}`,
      );
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error(
        `Line quantity must be a positive integer: ${line.quantity}`,
      );
    }
    const list = byStore.get(line.storeId) ?? [];
    list.push({ ...line, lineTotalCents: lineTotal(line) });
    byStore.set(line.storeId, list);
  }

  const storeIds = [...byStore.keys()];
  const subtotals = storeIds.map((id) =>
    (byStore.get(id) ?? []).reduce((sum, l) => sum + l.lineTotalCents, 0),
  );
  const subtotalCents = subtotals.reduce((sum, v) => sum + v, 0);

  // Both split by subtotal weight, both guaranteed to sum back exactly.
  const shippingSplit = allocateProportionally(shippingCents, subtotals);
  const discountSplit = allocateProportionally(discountCents, subtotals);

  const subOrders: SubOrderTotals[] = storeIds.map((storeId, index) => {
    const storeSubtotal = subtotals[index];
    const storeShipping = shippingSplit[index];
    const storeDiscount = discountSplit[index];

    // Commission is charged on goods only, not on shipping the seller pays to
    // provide. Charging on shipping means the platform profits from postage.
    const commissionCents = commissionFor(
      storeSubtotal - storeDiscount,
      commissionBps,
    );

    return {
      storeId,
      lines: byStore.get(storeId) ?? [],
      subtotalCents: storeSubtotal,
      shippingCents: storeShipping,
      discountCents: storeDiscount,
      commissionCents,
      payoutCents:
        storeSubtotal + storeShipping - storeDiscount - commissionCents,
    };
  });

  return {
    subtotalCents,
    shippingCents,
    discountCents,
    taxCents,
    totalCents: subtotalCents + shippingCents + taxCents - discountCents,
    subOrders,
  };
}

/**
 * The invariants that must hold for any order, checked at runtime.
 *
 * Called before the order is written. A split that does not reconcile must
 * never reach the database — finding out later means unpicking real payments.
 */
export function assertOrderBalances(totals: OrderTotals): void {
  const problems: string[] = [];

  const subtotalSum = totals.subOrders.reduce((s, o) => s + o.subtotalCents, 0);
  if (subtotalSum !== totals.subtotalCents) {
    problems.push(
      `sub-order subtotals ${subtotalSum} != order subtotal ${totals.subtotalCents}`,
    );
  }

  const shippingSum = totals.subOrders.reduce((s, o) => s + o.shippingCents, 0);
  if (shippingSum !== totals.shippingCents) {
    problems.push(
      `sub-order shipping ${shippingSum} != order shipping ${totals.shippingCents}`,
    );
  }

  const discountSum = totals.subOrders.reduce((s, o) => s + o.discountCents, 0);
  if (discountSum !== totals.discountCents) {
    problems.push(
      `sub-order discounts ${discountSum} != order discount ${totals.discountCents}`,
    );
  }

  // What the buyer pays, minus tax, must equal what the sellers and the
  // platform receive between them.
  const payoutSum = totals.subOrders.reduce((s, o) => s + o.payoutCents, 0);
  const commissionSum = totals.subOrders.reduce(
    (s, o) => s + o.commissionCents,
    0,
  );
  const distributed = payoutSum + commissionSum;
  const collected = totals.totalCents - totals.taxCents;
  if (distributed !== collected) {
    problems.push(
      `payouts ${payoutSum} + commission ${commissionSum} = ${distributed} != collected ${collected}`,
    );
  }

  if (totals.subOrders.some((o) => o.payoutCents < 0)) {
    problems.push("a sub-order has a negative payout");
  }

  if (problems.length > 0) {
    throw new Error(`Order does not balance:\n  ${problems.join("\n  ")}`);
  }
}
