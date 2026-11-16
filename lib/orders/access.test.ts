import { beforeAll, describe, expect, it } from "vitest";
import { orderPath, signOrderAccess, verifyOrderAccess } from "./access";

// The secret is read at call time precisely so this works — importing lib/env
// would make the whole suite need a real environment.
beforeAll(() => {
  process.env.BETTER_AUTH_SECRET = "test-secret-not-the-real-one-0123456789";
});

const ORDER = "01a08972-cd0b-795e-b317-0696713d630c";
const OTHER = "01a08971-667a-7ee4-8e21-a2ff569d925f";

describe("order access tokens", () => {
  it("accepts the token it issued", () => {
    expect(verifyOrderAccess(ORDER, signOrderAccess(ORDER))).toBe(true);
  });

  it("is stable, so a receipt link keeps working", () => {
    expect(signOrderAccess(ORDER)).toBe(signOrderAccess(ORDER));
  });

  /**
   * The whole point. Order ids are uuidv7 and therefore time-ordered, so
   * somebody holding one link knows roughly where its neighbours are — a token
   * that worked across orders would hand them the queue.
   */
  it("refuses a token minted for a different order", () => {
    expect(verifyOrderAccess(ORDER, signOrderAccess(OTHER))).toBe(false);
    expect(verifyOrderAccess(OTHER, signOrderAccess(ORDER))).toBe(false);
  });

  it.each([
    undefined,
    null,
    "",
    "   ",
    "not-a-token",
  ])("refuses %o rather than throwing", (token) => {
    expect(verifyOrderAccess(ORDER, token as string | undefined)).toBe(false);
  });

  /**
   * timingSafeEqual throws on a length mismatch, and this value arrives
   * straight from a query string — so a short one must be a refusal, not a 500.
   */
  it("refuses tokens of the wrong length without throwing", () => {
    const real = signOrderAccess(ORDER);
    expect(() => verifyOrderAccess(ORDER, real.slice(0, 4))).not.toThrow();
    expect(verifyOrderAccess(ORDER, real.slice(0, 4))).toBe(false);
    expect(verifyOrderAccess(ORDER, `${real}extra`)).toBe(false);
  });

  it("refuses a token with one character changed", () => {
    const real = signOrderAccess(ORDER);
    const flipped = `${real[0] === "a" ? "b" : "a"}${real.slice(1)}`;
    expect(verifyOrderAccess(ORDER, flipped)).toBe(false);
  });

  it("is url-safe, since it travels in a query string", () => {
    expect(signOrderAccess(ORDER)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("builds a path the order page can read", () => {
    const path = orderPath(ORDER);
    expect(path.startsWith(`/orders/${ORDER}?t=`)).toBe(true);

    const token = new URL(path, "https://example.com").searchParams.get("t");
    expect(verifyOrderAccess(ORDER, token)).toBe(true);
  });
});
