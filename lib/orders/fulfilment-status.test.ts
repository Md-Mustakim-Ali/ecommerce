import { describe, expect, it } from "vitest";
import { deriveOrderStatus } from "./fulfilment-status";

/**
 * These exist because the rule they cover was wrong and untestable at once —
 * it lived inside a "use server" module that reaches the database, so nothing
 * ever exercised it.
 */

describe("deriveOrderStatus", () => {
  /**
   * The bug. Cancelling one seller's part of a two-seller order runs this with
   * the other part still pending and nothing shipped. It used to return `paid`,
   * which marked an unpaid order paid — writing no ledger entries, crediting no
   * seller, and making the order look covered so the buyer could no longer pay
   * for it.
   */
  it("says nothing about payment when nothing has shipped", () => {
    expect(deriveOrderStatus(["pending"])).toBeNull();
    expect(deriveOrderStatus(["accepted"])).toBeNull();
    expect(deriveOrderStatus(["pending", "accepted"])).toBeNull();
    // The exact shape that caused it: one part cancelled, the rest unshipped.
    expect(deriveOrderStatus(["cancelled", "pending"])).toBeNull();
  });

  it("is fulfilled once every live part has shipped", () => {
    expect(deriveOrderStatus(["shipped"])).toBe("fulfilled");
    expect(deriveOrderStatus(["delivered", "shipped"])).toBe("fulfilled");
  });

  /** A cancelled part must not hold an otherwise-complete order open. */
  it("ignores cancelled and refunded parts when deciding completeness", () => {
    expect(deriveOrderStatus(["cancelled", "delivered"])).toBe("fulfilled");
    expect(deriveOrderStatus(["refunded", "shipped"])).toBe("fulfilled");
  });

  it("is partially fulfilled while some parts are still coming", () => {
    expect(deriveOrderStatus(["shipped", "pending"])).toBe(
      "partially_fulfilled",
    );
    expect(deriveOrderStatus(["delivered", "accepted"])).toBe(
      "partially_fulfilled",
    );
  });

  it("is cancelled when every part is gone", () => {
    expect(deriveOrderStatus(["cancelled"])).toBe("cancelled");
    expect(deriveOrderStatus(["cancelled", "cancelled"])).toBe("cancelled");
  });

  /**
   * Refunded only when they all are. A mix is a cancelled order that happened
   * to include a refund, and calling the whole thing `refunded` would put a
   * refund that never happened into revenue reporting.
   */
  it("is refunded only when every part was refunded", () => {
    expect(deriveOrderStatus(["refunded"])).toBe("refunded");
    expect(deriveOrderStatus(["refunded", "refunded"])).toBe("refunded");
    expect(deriveOrderStatus(["refunded", "cancelled"])).toBe("cancelled");
  });

  it("invents nothing for an order with no parts", () => {
    expect(deriveOrderStatus([])).toBeNull();
  });

  /**
   * The guarantee that matters, stated directly: no combination of fulfilment
   * states may ever produce a payment state.
   */
  it("can never return a payment status", () => {
    const all: Parameters<typeof deriveOrderStatus>[0] = [
      "pending",
      "accepted",
      "shipped",
      "delivered",
      "cancelled",
      "refunded",
    ];

    for (const a of all) {
      for (const b of all) {
        const result = deriveOrderStatus([a, b]);
        expect(result).not.toBe("paid");
        expect(result).not.toBe("pending");
        expect(result).not.toBe("unconfirmed");
        expect(result).not.toBe("payment_reversed");
      }
    }
  });
});
