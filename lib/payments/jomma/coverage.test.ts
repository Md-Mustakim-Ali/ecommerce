import { describe, expect, it } from "vitest";
import { coverageOf } from "./coverage";

/**
 * The rule that decides an order is paid for.
 *
 * It used to be "did this intent receive the order total", which was true while
 * an order had exactly one intent for its full price. A buyer who sends ৳100 of
 * ৳184 and lets the intent expire gets a new one for the ৳84 they still owe —
 * and from that moment no single intent ever sees the total, so the old rule
 * could never be satisfied and the order would sit pending forever holding the
 * money.
 */

const TOTAL = 18400;

describe("coverageOf", () => {
  it("is not covered when nothing has arrived", () => {
    const c = coverageOf({ totalCents: TOTAL, receivedCents: 0 });
    expect(c.covered).toBe(false);
    expect(c.outstandingCents).toBe(TOTAL);
    expect(c.overpaidCents).toBe(0);
  });

  it("reports the balance on a part payment", () => {
    const c = coverageOf({ totalCents: TOTAL, receivedCents: 10000 });
    expect(c.covered).toBe(false);
    expect(c.outstandingCents).toBe(8400);
  });

  /** The case the whole change exists for: two intents adding up. */
  it("covers an order paid across more than one intent", () => {
    const c = coverageOf({ totalCents: TOTAL, receivedCents: 10000 + 8400 });
    expect(c.covered).toBe(true);
    expect(c.outstandingCents).toBe(0);
  });

  it("counts exact payment as covered", () => {
    expect(
      coverageOf({ totalCents: TOTAL, receivedCents: TOTAL }).covered,
    ).toBe(true);
  });

  /**
   * `>=`, not `===`. Refusing to fulfil because somebody sent too much would be
   * the wrong way round — they have paid, and the excess is a debt back to them.
   */
  it("treats an overpayment as paid, and names what is owed back", () => {
    const c = coverageOf({ totalCents: TOTAL, receivedCents: TOTAL + 1100 });
    expect(c.covered).toBe(true);
    expect(c.outstandingCents).toBe(0);
    expect(c.overpaidCents).toBe(1100);
  });

  it("never reports both an outstanding balance and an overpayment", () => {
    for (const received of [0, 1, 9999, TOTAL - 1, TOTAL, TOTAL + 1, 99999]) {
      const c = coverageOf({ totalCents: TOTAL, receivedCents: received });
      expect(Math.min(c.outstandingCents, c.overpaidCents)).toBe(0);
    }
  });

  // A free order is covered by definition. Getting this wrong would leave a
  // ৳0 order permanently unpayable, since there is nothing to send.
  it("covers a zero-total order", () => {
    expect(coverageOf({ totalCents: 0, receivedCents: 0 }).covered).toBe(true);
  });
});
