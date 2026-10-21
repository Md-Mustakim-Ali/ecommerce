export type StockDisplay = "never" | "always" | "when_low";

export type StockMessage =
  | { kind: "sold-out"; text: string }
  | { kind: "low"; text: string; quantity: number }
  | { kind: "in-stock"; text: string }
  | { kind: "hidden" };

/**
 * What to tell a buyer about stock.
 *
 * The quantity always belongs to one variant, never to the product. A product
 * with 40 units spread across ten combinations has 4 of the one somebody
 * actually wants, and showing 40 on that page is a lie that produces a
 * cancelled order.
 *
 * `when_low` is the default because a number is most useful exactly when it is
 * small. Above the threshold "In stock" carries the same decision-relevant
 * information without handing a competitor an inventory report.
 */
export function stockMessage(input: {
  quantity: number | null;
  display: StockDisplay;
  lowStockThreshold: number;
  /** False before a combination has been chosen. */
  resolved: boolean;
}): StockMessage {
  const { quantity, display, lowStockThreshold, resolved } = input;

  // Nothing chosen yet, so there is no single number to quote.
  if (!resolved || quantity === null) {
    return quantity === 0
      ? { kind: "sold-out", text: "Sold out" }
      : { kind: "hidden" };
  }

  if (quantity <= 0) return { kind: "sold-out", text: "Sold out" };

  const isLow = quantity <= lowStockThreshold;

  if (display === "never") {
    return { kind: "in-stock", text: "In stock" };
  }

  if (display === "always") {
    return isLow
      ? { kind: "low", text: `Only ${quantity} left`, quantity }
      : { kind: "in-stock", text: `${quantity} in stock` };
  }

  // when_low
  return isLow
    ? { kind: "low", text: `Only ${quantity} left`, quantity }
    : { kind: "in-stock", text: "In stock" };
}

/**
 * Product-level availability for a grid card, where no combination is chosen.
 *
 * Deliberately never quotes the summed total even when the seller asked for
 * exact counts — the sum is not the stock of anything a shopper can buy. It
 * only reports low stock when the whole product is nearly gone.
 */
export function cardStockMessage(input: {
  totalQuantity: number;
  display: StockDisplay;
  lowStockThreshold: number;
}): StockMessage {
  if (input.totalQuantity <= 0) return { kind: "sold-out", text: "Sold out" };
  if (input.display === "never") return { kind: "hidden" };

  return input.totalQuantity <= input.lowStockThreshold
    ? {
        kind: "low",
        text: `Only ${input.totalQuantity} left`,
        quantity: input.totalQuantity,
      }
    : { kind: "hidden" };
}
