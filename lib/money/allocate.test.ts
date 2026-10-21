import { describe, expect, it } from "vitest";
import { allocateEvenly, allocateProportionally } from "./allocate";

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe("allocateProportionally", () => {
  it("never loses or invents a cent", () => {
    // The whole reason this function exists. Independent rounding gives
    // 333 + 333 + 333 = 999 and one cent disappears.
    const parts = allocateProportionally(1000, [1, 1, 1]);
    expect(sum(parts)).toBe(1000);
    expect(parts).toEqual([334, 333, 333]);
  });

  it("splits proportionally to the weights", () => {
    const parts = allocateProportionally(1000, [700, 300]);
    expect(parts).toEqual([700, 300]);
    expect(sum(parts)).toBe(1000);
  });

  it("gives the leftover to whoever was rounded down hardest", () => {
    // 100 across weights 1,1,1,1,1,1,1 -> 14.28 each. Seven floors of 14 is
    // 98, so two parts get the extra cent.
    const parts = allocateProportionally(100, [1, 1, 1, 1, 1, 1, 1]);
    expect(sum(parts)).toBe(100);
    expect(parts.filter((p) => p === 15)).toHaveLength(2);
    expect(parts.filter((p) => p === 14)).toHaveLength(5);
  });

  it("is deterministic for the same input", () => {
    // Two runs must agree, or two payouts for the same order disagree.
    const a = allocateProportionally(1237, [451, 300, 486]);
    const b = allocateProportionally(1237, [451, 300, 486]);
    expect(a).toEqual(b);
  });

  it("handles a negative total, as a discount spread across stores", () => {
    const parts = allocateProportionally(-1000, [1, 1, 1]);
    expect(sum(parts)).toBe(-1000);
    for (const part of parts) expect(part).toBeLessThan(0);
  });

  it("splits evenly when every weight is zero", () => {
    // An order where every line is free still has to allocate shipping.
    const parts = allocateProportionally(100, [0, 0, 0]);
    expect(sum(parts)).toBe(100);
  });

  it("returns an empty array for no parts", () => {
    expect(allocateProportionally(500, [])).toEqual([]);
  });

  it("handles a zero total", () => {
    expect(allocateProportionally(0, [5, 3, 2])).toEqual([0, 0, 0]);
  });

  it("rejects fractional input", () => {
    // Guards against a float sneaking in from somewhere upstream.
    expect(() => allocateProportionally(10.5, [1, 1])).toThrow(/integer/);
  });

  it("rejects negative weights", () => {
    expect(() => allocateProportionally(100, [1, -1])).toThrow(/negative/);
  });

  it("sums exactly across a wide sweep of inputs", () => {
    // Property check. Any rounding scheme looks fine on the examples its
    // author picked; this is the assertion that actually matters.
    for (let total = 0; total <= 500; total += 7) {
      for (const weights of [
        [1, 2, 3],
        [7, 11, 13, 17],
        [1, 1],
        [999, 1],
        [5, 5, 5, 5, 5, 5, 5],
      ]) {
        expect(
          sum(allocateProportionally(total, weights)),
          `${total} / ${weights}`,
        ).toBe(total);
      }
    }
  });
});

describe("allocateEvenly", () => {
  it("sums exactly", () => {
    expect(sum(allocateEvenly(100, 3))).toBe(100);
    expect(allocateEvenly(100, 3)).toEqual([34, 33, 33]);
  });

  it("handles exact division", () => {
    expect(allocateEvenly(90, 3)).toEqual([30, 30, 30]);
  });

  it("handles negatives", () => {
    expect(sum(allocateEvenly(-100, 3))).toBe(-100);
  });

  it("returns empty for zero parts", () => {
    expect(allocateEvenly(100, 0)).toEqual([]);
  });
});
