import { describe, expect, it } from "vitest";
import { cardStockMessage, stockMessage } from "./stock";

const base = {
  display: "when_low" as const,
  lowStockThreshold: 5,
  resolved: true,
};

describe("stockMessage", () => {
  it("says nothing until a combination is chosen", () => {
    // A product with 40 units across ten combinations has 4 of the one you
    // want. Quoting 40 before a choice is made is a lie.
    expect(stockMessage({ ...base, quantity: 40, resolved: false })).toEqual({
      kind: "hidden",
    });
  });

  it("reports sold out even before a choice when nothing is left", () => {
    expect(stockMessage({ ...base, quantity: 0, resolved: false })).toEqual({
      kind: "sold-out",
      text: "Sold out",
    });
  });

  describe("when_low", () => {
    it("shows the number at or below the threshold", () => {
      expect(stockMessage({ ...base, quantity: 3 })).toEqual({
        kind: "low",
        text: "Only 3 left",
        quantity: 3,
      });
      expect(stockMessage({ ...base, quantity: 5 }).kind).toBe("low");
    });

    it("hides the number above the threshold", () => {
      expect(stockMessage({ ...base, quantity: 6 })).toEqual({
        kind: "in-stock",
        text: "In stock",
      });
    });

    it("respects a seller's custom threshold", () => {
      expect(
        stockMessage({ ...base, quantity: 18, lowStockThreshold: 20 }).kind,
      ).toBe("low");
    });
  });

  describe("always", () => {
    it("shows the exact count", () => {
      expect(
        stockMessage({ ...base, display: "always", quantity: 42 }),
      ).toEqual({
        kind: "in-stock",
        text: "42 in stock",
      });
    });

    it("still emphasises a low count", () => {
      expect(
        stockMessage({ ...base, display: "always", quantity: 2 }).kind,
      ).toBe("low");
    });
  });

  describe("never", () => {
    it("never reveals a quantity, however low", () => {
      const result = stockMessage({ ...base, display: "never", quantity: 1 });
      expect(result).toEqual({ kind: "in-stock", text: "In stock" });
      expect(JSON.stringify(result)).not.toContain("1 left");
    });

    it("still says sold out", () => {
      expect(
        stockMessage({ ...base, display: "never", quantity: 0 }).kind,
      ).toBe("sold-out");
    });
  });
});

describe("cardStockMessage", () => {
  it("never quotes the summed total as though it were buyable", () => {
    // The sum across combinations is not the stock of anything a shopper can
    // add to a cart, so a grid card must not present it as a count.
    expect(
      cardStockMessage({
        totalQuantity: 40,
        display: "always",
        lowStockThreshold: 5,
      }),
    ).toEqual({ kind: "hidden" });
  });

  it("warns when the whole product is nearly gone", () => {
    expect(
      cardStockMessage({
        totalQuantity: 2,
        display: "when_low",
        lowStockThreshold: 5,
      }),
    ).toEqual({ kind: "low", text: "Only 2 left", quantity: 2 });
  });

  it("reports sold out", () => {
    expect(
      cardStockMessage({
        totalQuantity: 0,
        display: "when_low",
        lowStockThreshold: 5,
      }).kind,
    ).toBe("sold-out");
  });

  it("stays silent when the seller opted out", () => {
    expect(
      cardStockMessage({
        totalQuantity: 1,
        display: "never",
        lowStockThreshold: 5,
      }),
    ).toEqual({ kind: "hidden" });
  });
});
