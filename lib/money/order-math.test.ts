import { describe, expect, it } from "vitest";
import {
  assertOrderBalances,
  buildOrderTotals,
  type CartLineInput,
  commissionFor,
  DEFAULT_COMMISSION_BPS,
} from "./order-math";

const line = (
  storeId: string,
  unitPriceCents: number,
  quantity = 1,
): CartLineInput => ({
  variantId: `${storeId}-${unitPriceCents}-${quantity}`,
  storeId,
  unitPriceCents,
  quantity,
});

describe("commissionFor", () => {
  it("computes basis points", () => {
    expect(commissionFor(10_000, 1000)).toBe(1000); // 10% of 100.00
    expect(commissionFor(1999, 1000)).toBe(199); // 10% of 19.99, floored
  });

  it("rounds down, so the fractional cent goes to the seller", () => {
    // 15% of 19.99 is 299.85. Flooring hands the seller the remainder, which
    // is a deliberate and documented direction.
    expect(commissionFor(1999, 1500)).toBe(299);
  });

  it("returns zero for zero and negative amounts", () => {
    expect(commissionFor(0, 1000)).toBe(0);
    expect(commissionFor(-500, 1000)).toBe(0);
  });

  it("handles the boundaries", () => {
    expect(commissionFor(1000, 0)).toBe(0);
    expect(commissionFor(1000, 10_000)).toBe(1000);
  });

  it("rejects out-of-range rates and fractional amounts", () => {
    expect(() => commissionFor(1000, -1)).toThrow(/out of range/);
    expect(() => commissionFor(1000, 10_001)).toThrow(/out of range/);
    expect(() => commissionFor(10.5, 1000)).toThrow(/integer/);
  });
});

describe("buildOrderTotals", () => {
  it("splits a single-store cart", () => {
    const totals = buildOrderTotals({ lines: [line("a", 1000, 2)] });

    expect(totals.subtotalCents).toBe(2000);
    expect(totals.totalCents).toBe(2000);
    expect(totals.subOrders).toHaveLength(1);
    expect(totals.subOrders[0].commissionCents).toBe(200);
    expect(totals.subOrders[0].payoutCents).toBe(1800);
    assertOrderBalances(totals);
  });

  it("splits a cart across three stores into three sub-orders", () => {
    // The case the whole schema exists for: one payment, three fulfilments.
    const totals = buildOrderTotals({
      lines: [line("a", 1000), line("b", 2000), line("c", 500, 2)],
    });

    expect(totals.subOrders).toHaveLength(3);
    expect(totals.subtotalCents).toBe(4000);
    assertOrderBalances(totals);
  });

  it("divides shipping across stores and loses nothing", () => {
    const totals = buildOrderTotals({
      lines: [line("a", 1000), line("b", 1000), line("c", 1000)],
      shippingCents: 1000,
    });

    const shippingSum = totals.subOrders.reduce(
      (s, o) => s + o.shippingCents,
      0,
    );
    expect(shippingSum).toBe(1000);
    expect(totals.totalCents).toBe(4000);
    assertOrderBalances(totals);
  });

  it("divides an awkward shipping amount exactly", () => {
    // 1 cent across three stores. Independent rounding would give 0,0,0.
    const totals = buildOrderTotals({
      lines: [line("a", 1000), line("b", 1000), line("c", 1000)],
      shippingCents: 1,
    });
    expect(totals.subOrders.reduce((s, o) => s + o.shippingCents, 0)).toBe(1);
    assertOrderBalances(totals);
  });

  it("divides a discount across stores", () => {
    const totals = buildOrderTotals({
      lines: [line("a", 3000), line("b", 1000)],
      discountCents: 500,
    });

    expect(totals.subOrders.reduce((s, o) => s + o.discountCents, 0)).toBe(500);
    // Weighted by subtotal: 75/25.
    expect(totals.subOrders[0].discountCents).toBe(375);
    expect(totals.subOrders[1].discountCents).toBe(125);
    expect(totals.totalCents).toBe(3500);
    assertOrderBalances(totals);
  });

  it("charges commission on goods, not on shipping", () => {
    // Otherwise the platform profits from postage the seller pays to provide.
    const withShipping = buildOrderTotals({
      lines: [line("a", 10_000)],
      shippingCents: 5000,
    });
    const withoutShipping = buildOrderTotals({ lines: [line("a", 10_000)] });

    expect(withShipping.subOrders[0].commissionCents).toBe(
      withoutShipping.subOrders[0].commissionCents,
    );
    expect(withShipping.subOrders[0].payoutCents).toBe(
      withoutShipping.subOrders[0].payoutCents + 5000,
    );
  });

  it("charges commission after the discount, not before", () => {
    const totals = buildOrderTotals({
      lines: [line("a", 10_000)],
      discountCents: 2000,
    });
    // 10% of (10000 - 2000)
    expect(totals.subOrders[0].commissionCents).toBe(800);
    assertOrderBalances(totals);
  });

  it("adds tax to the total without distributing it to sellers", () => {
    // Tax is collected on behalf of a government, not earned by anybody here.
    const totals = buildOrderTotals({
      lines: [line("a", 10_000)],
      taxCents: 2000,
    });
    expect(totals.totalCents).toBe(12_000);
    expect(totals.subOrders[0].payoutCents).toBe(9000);
    assertOrderBalances(totals);
  });

  it("groups multiple lines from the same store into one sub-order", () => {
    const totals = buildOrderTotals({
      lines: [line("a", 1000), line("a", 2000), line("b", 500)],
    });
    expect(totals.subOrders).toHaveLength(2);
    expect(totals.subOrders[0].lines).toHaveLength(2);
    expect(totals.subOrders[0].subtotalCents).toBe(3000);
  });

  it("rejects an empty cart and malformed lines", () => {
    expect(() => buildOrderTotals({ lines: [] })).toThrow(/empty cart/);
    expect(() => buildOrderTotals({ lines: [line("a", 19.99)] })).toThrow(
      /integer/,
    );
    expect(() => buildOrderTotals({ lines: [line("a", 100, 0)] })).toThrow(
      /positive/,
    );
  });

  it("balances across a wide sweep of carts", () => {
    // Property check. assertOrderBalances is the real assertion; if any
    // combination fails to reconcile it throws.
    for (let shipping = 0; shipping <= 200; shipping += 13) {
      for (let discount = 0; discount <= 300; discount += 17) {
        for (const prices of [
          [999, 1999, 2999],
          [1, 1, 1],
          [12_345, 6789],
          [500],
        ]) {
          const lines = prices.map((p, i) => line(`store-${i}`, p));
          const totals = buildOrderTotals({
            lines,
            shippingCents: shipping,
            discountCents: Math.min(
              discount,
              prices.reduce((a, b) => a + b, 0),
            ),
            commissionBps: DEFAULT_COMMISSION_BPS,
          });
          expect(() => assertOrderBalances(totals)).not.toThrow();
        }
      }
    }
  });
});

describe("assertOrderBalances", () => {
  it("catches a tampered split", () => {
    const totals = buildOrderTotals({
      lines: [line("a", 1000), line("b", 1000)],
      shippingCents: 100,
    });

    // Simulate a bug that hands one seller an extra cent.
    totals.subOrders[0].payoutCents += 1;
    expect(() => assertOrderBalances(totals)).toThrow(/does not balance/);
  });

  it("catches a negative payout", () => {
    const totals = buildOrderTotals({ lines: [line("a", 1000)] });
    totals.subOrders[0].payoutCents = -1;
    expect(() => assertOrderBalances(totals)).toThrow(/negative payout/);
  });
});
