import { beforeAll, describe, expect, it } from "vitest";

/**
 * Imported dynamically: this module reaches lib/email, which reaches lib/env,
 * which parses the whole environment at module load.
 */
type Confirmation = typeof import("./confirmation");
let mod: Confirmation;

const ORDER = "01a089ba-5146-71bd-9750-263c0ca761a8";
const OTHER = "01a08972-cd0b-795e-b317-0696713d630c";

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/db";
  process.env.BETTER_AUTH_SECRET ??= "test-secret-not-the-real-one-0123456789";
  process.env.BETTER_AUTH_URL ??= "https://shop.example.com";
  mod = await import("./confirmation");
});

describe("confirmation tokens", () => {
  it("accepts the token it issued", () => {
    expect(mod.verifyOrderConfirm(ORDER, mod.signOrderConfirm(ORDER))).toBe(
      true,
    );
  });

  it("refuses a token minted for another order", () => {
    expect(mod.verifyOrderConfirm(ORDER, mod.signOrderConfirm(OTHER))).toBe(
      false,
    );
  });

  /**
   * The reason confirming has its own token rather than reusing the access one.
   * Receipt links get forwarded; the power to confirm an order must not travel
   * with them.
   */
  it("is not the same token as the one that opens the order", async () => {
    const { signOrderAccess } = await import("./access");
    expect(mod.signOrderConfirm(ORDER)).not.toBe(signOrderAccess(ORDER));
    expect(mod.verifyOrderConfirm(ORDER, signOrderAccess(ORDER))).toBe(false);
  });

  it.each([
    undefined,
    null,
    "",
    "nonsense",
    "short",
  ])("refuses %o without throwing", (token) => {
    expect(() =>
      mod.verifyOrderConfirm(ORDER, token as string | undefined),
    ).not.toThrow();
    expect(mod.verifyOrderConfirm(ORDER, token as string | undefined)).toBe(
      false,
    );
  });
});

describe("who has to confirm", () => {
  /**
   * A signed-in buyer proved their contact once. Asking again per order would
   * be theatre, and would punish exactly the people who did register.
   */
  it("never gates a buyer whose contact is already verified", () => {
    expect(
      mod.needsConfirmation({
        email: "buyer@example.com",
        contactPhone: "01712345678",
        buyerVerified: true,
      }),
    ).toBe(false);
  });

  it("gates a guest who gave a reachable contact", () => {
    expect(
      mod.needsConfirmation({
        email: "guest@example.com",
        contactPhone: null,
        buyerVerified: false,
      }),
    ).toBe(true);
  });

  /**
   * The rule that keeps the shop sellable while a channel is missing: gating
   * an order nobody can confirm just means refusing the sale.
   */
  it("does not gate a contact no channel can reach", () => {
    expect(
      mod.needsConfirmation({
        email: null,
        contactPhone: null,
        buyerVerified: false,
      }),
    ).toBe(false);
  });
});

/**
 * The typed alternative to the link.
 *
 * Both prove the same thing — that whoever holds it received the message sent
 * to the contact on the order — so they are accepted interchangeably. The code
 * exists because buttons in email are unreliable and because the page is often
 * open on a different device from the mail.
 */
describe("confirmation codes", () => {
  it("is six digits, so it can be read aloud and typed", () => {
    expect(mod.orderConfirmCode(ORDER)).toMatch(/^\d{6}$/);
    expect(mod.orderConfirmCode(ORDER)).toHaveLength(mod.CONFIRM_CODE_DIGITS);
  });

  it("is stable, so resending the email does not invalidate the first one", () => {
    expect(mod.orderConfirmCode(ORDER)).toBe(mod.orderConfirmCode(ORDER));
  });

  it("accepts the code it issued", () => {
    expect(mod.verifyOrderConfirmCode(ORDER, mod.orderConfirmCode(ORDER))).toBe(
      true,
    );
  });

  /**
   * The one that matters. Order ids are uuidv7 and therefore time-ordered, so
   * somebody holding one order knows roughly where its neighbours are — a code
   * that worked across orders would hand them the queue.
   */
  it("refuses a code minted for a different order", () => {
    expect(mod.verifyOrderConfirmCode(ORDER, mod.orderConfirmCode(OTHER))).toBe(
      false,
    );
    expect(mod.verifyOrderConfirmCode(OTHER, mod.orderConfirmCode(ORDER))).toBe(
      false,
    );
  });

  it("refuses nothing, and refuses rubbish", () => {
    expect(mod.verifyOrderConfirmCode(ORDER, "")).toBe(false);
    expect(mod.verifyOrderConfirmCode(ORDER, null)).toBe(false);
    expect(mod.verifyOrderConfirmCode(ORDER, undefined)).toBe(false);
    expect(mod.verifyOrderConfirmCode(ORDER, "000000")).toBe(
      mod.orderConfirmCode(ORDER) === "000000",
    );
    // Short input must not throw — timingSafeEqual rejects mismatched lengths.
    expect(mod.verifyOrderConfirmCode(ORDER, "1")).toBe(false);
  });

  /** People paste codes with spaces and hyphens in them. */
  it("forgives how it was typed", () => {
    const code = mod.orderConfirmCode(ORDER);
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    const hyphened = `${code.slice(0, 3)}-${code.slice(3)}`;
    expect(mod.verifyOrderConfirmCode(ORDER, spaced)).toBe(true);
    expect(mod.verifyOrderConfirmCode(ORDER, hyphened)).toBe(true);
  });

  /**
   * A code is not a token. Feeding one where the other belongs must fail, or
   * the short guessable credential would unlock everything the long one does.
   */
  it("is not interchangeable with the link's token", () => {
    expect(mod.verifyOrderConfirm(ORDER, mod.orderConfirmCode(ORDER))).toBe(
      false,
    );
    expect(mod.verifyOrderConfirmCode(ORDER, mod.signOrderConfirm(ORDER))).toBe(
      false,
    );
  });
});
