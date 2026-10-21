import { describe, expect, it } from "vitest";
import {
  applyDiscount,
  type DiscountDefinition,
  type DiscountLine,
  normaliseCode,
} from "./apply";

const NOW = new Date("2026-09-03T12:00:00Z");

function code(overrides: Partial<DiscountDefinition> = {}): DiscountDefinition {
  return {
    id: "d1",
    code: "SAVE10",
    scope: "platform",
    storeId: null,
    kind: "percentage",
    value: 1000, // 10%
    maxDiscountCents: null,
    minSubtotalCents: 0,
    maxRedemptions: null,
    redemptionCount: 0,
    perCustomerLimit: 1,
    status: "published",
    startsAt: null,
    endsAt: null,
    ...overrides,
  };
}

const LINES: DiscountLine[] = [
  { id: "a", storeId: "store-1", lineTotalCents: 6000 },
  { id: "b", storeId: "store-1", lineTotalCents: 3000 },
  { id: "c", storeId: "store-2", lineTotalCents: 1000 },
];

function run(
  discount: DiscountDefinition,
  lines = LINES,
  extra: { shippingCents?: number; customerRedemptions?: number } = {},
) {
  return applyDiscount({
    discount,
    lines,
    shippingCents: extra.shippingCents ?? 599,
    customerRedemptions: extra.customerRedemptions ?? 0,
    now: NOW,
  });
}

describe("scheduling and status", () => {
  it("refuses a draft", () => {
    const result = run(code({ status: "draft" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not-active");
  });

  it("refuses one that has not started", () => {
    const result = run(code({ startsAt: new Date("2026-10-01") }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not-started");
  });

  it("refuses an expired one", () => {
    const result = run(code({ endsAt: new Date("2026-08-01") }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("accepts one inside its window", () => {
    const result = run(
      code({
        startsAt: new Date("2026-09-01"),
        endsAt: new Date("2026-09-30"),
      }),
    );
    expect(result.ok).toBe(true);
  });
});

describe("redemption limits", () => {
  it("refuses when fully claimed", () => {
    const result = run(code({ maxRedemptions: 100, redemptionCount: 100 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("fully-redeemed");
  });

  it("allows the last one", () => {
    expect(run(code({ maxRedemptions: 100, redemptionCount: 99 })).ok).toBe(
      true,
    );
  });

  it("refuses a repeat customer at the limit", () => {
    const result = run(code({ perCustomerLimit: 1 }), LINES, {
      customerRedemptions: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("customer-limit");
  });

  it("allows unlimited per customer when the limit is null", () => {
    const result = run(code({ perCustomerLimit: null }), LINES, {
      customerRedemptions: 50,
    });
    expect(result.ok).toBe(true);
  });
});

describe("percentage", () => {
  it("takes the right share of the whole cart", () => {
    const result = run(code({ value: 1000 }));
    expect(result.ok).toBe(true);
    // 10% of 10,000.
    if (result.ok) expect(result.amountCents).toBe(1000);
  });

  it("floors the fractional cent", () => {
    // 12.5% of 333 = 41.625 -> 41.
    const result = run(code({ value: 1250 }), [
      { id: "a", storeId: "s", lineTotalCents: 333 },
    ]);
    if (result.ok) expect(result.amountCents).toBe(41);
  });

  it("respects a cap", () => {
    const result = run(code({ value: 5000, maxDiscountCents: 2000 }));
    // 50% of 10,000 is 5,000, capped at 2,000.
    if (result.ok) expect(result.amountCents).toBe(2000);
  });

  it("never exceeds the eligible subtotal", () => {
    const result = run(code({ kind: "fixed_amount", value: 999_999 }));
    if (result.ok) expect(result.amountCents).toBe(10_000);
  });
});

describe("store scoping", () => {
  const storeCode = code({
    scope: "store",
    storeId: "store-1",
    kind: "fixed_amount",
    value: 1500,
  });

  it("only discounts that store's lines", () => {
    const result = run(storeCode);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // store-2 must not be touched at all.
    expect(result.perStore["store-2"]).toBeUndefined();
    expect(result.perStore["store-1"]).toBe(1500);
    expect(result.perLine.every((line) => line.storeId === "store-1")).toBe(
      true,
    );
  });

  it("measures the minimum against that store's lines only", () => {
    // The cart is 10,000 overall but only 1,000 at store-2.
    const result = run(
      code({
        scope: "store",
        storeId: "store-2",
        minSubtotalCents: 5000,
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("below-minimum");
  });

  it("refuses when the store has nothing in the cart", () => {
    const result = run(code({ scope: "store", storeId: "store-99" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("nothing-eligible");
  });
});

describe("allocation", () => {
  it("splits exactly, with no cent lost or invented", () => {
    const result = run(code({ value: 1000 }));
    if (!result.ok) throw new Error("expected success");

    const summed = result.perLine.reduce((s, l) => s + l.amountCents, 0);
    expect(summed).toBe(result.amountCents);
  });

  it("splits proportionally", () => {
    const result = run(code({ kind: "fixed_amount", value: 1000 }));
    if (!result.ok) throw new Error("expected success");
    // 6000/3000/1000 of 10,000 -> 600/300/100 of 1,000.
    expect(result.perLine.map((l) => l.amountCents)).toEqual([600, 300, 100]);
  });

  it("still sums exactly when the split does not divide evenly", () => {
    const result = run(code({ kind: "fixed_amount", value: 100 }), [
      { id: "a", storeId: "s", lineTotalCents: 333 },
      { id: "b", storeId: "s", lineTotalCents: 333 },
      { id: "c", storeId: "s", lineTotalCents: 334 },
    ]);
    if (!result.ok) throw new Error("expected success");

    expect(result.perLine.reduce((s, l) => s + l.amountCents, 0)).toBe(100);
  });

  it("per-store totals sum to the whole", () => {
    const result = run(code({ value: 2500 }));
    if (!result.ok) throw new Error("expected success");

    const summed = Object.values(result.perStore).reduce((s, v) => s + v, 0);
    expect(summed).toBe(result.amountCents);
  });
});

describe("free shipping", () => {
  it("discounts shipping and not the items", () => {
    const result = run(code({ kind: "free_shipping", value: 0 }), LINES, {
      shippingCents: 599,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.amountCents).toBe(0);
    expect(result.shippingDiscountCents).toBe(599);
  });

  it("is worth nothing when shipping is already free", () => {
    const result = run(code({ kind: "free_shipping" }), LINES, {
      shippingCents: 0,
    });
    if (result.ok) expect(result.shippingDiscountCents).toBe(0);
  });
});

describe("minimum spend", () => {
  it("refuses below it", () => {
    const result = run(code({ minSubtotalCents: 20_000 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("below-minimum");
  });

  it("accepts exactly at it", () => {
    expect(run(code({ minSubtotalCents: 10_000 })).ok).toBe(true);
  });
});

describe("code normalisation", () => {
  it("upper-cases and trims", () => {
    expect(normaliseCode("  save10 ")).toBe("SAVE10");
    expect(normaliseCode("SaVe10")).toBe("SAVE10");
  });
});
