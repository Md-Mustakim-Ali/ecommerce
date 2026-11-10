import { describe, expect, it } from "vitest";
import { isDeliverablePhone, normaliseBdMobile } from "./phone";

/**
 * The delivery phone rule.
 *
 * These used to re-declare the regex, because the rule lived inside a
 * "use server" module that drags in the database and the session. That made
 * the tests worth very little: they proved a copy of the rule behaved, not the
 * rule itself, and would have passed happily while checkout did something else.
 *
 * The rule now lives in ./phone.ts, imported by both the checkout validator and
 * the payment path, so these exercise the real thing.
 */

describe("normaliseBdMobile", () => {
  it("returns the canonical form for a plain mobile", () => {
    expect(normaliseBdMobile("01712345678")).toBe("01712345678");
    expect(normaliseBdMobile("01312345678")).toBe("01312345678");
    expect(normaliseBdMobile("01912345678")).toBe("01912345678");
  });

  it("strips the punctuation people actually type", () => {
    for (const typed of [
      "017 1234 5678",
      "017-1234-5678",
      "(017) 1234-5678",
      "017.1234.5678",
      "  01712345678  ",
    ]) {
      expect(normaliseBdMobile(typed)).toBe("01712345678");
    }
  });

  it("folds the country prefix down to the local form", () => {
    // Jomma validates a bare 01XXXXXXXXX. Sending +880… would be rejected for
    // a number that is perfectly correct, so this is not cosmetic.
    expect(normaliseBdMobile("+8801712345678")).toBe("01712345678");
    expect(normaliseBdMobile("8801712345678")).toBe("01712345678");
    expect(normaliseBdMobile("+880 1712 345 678")).toBe("01712345678");
  });

  it("returns null for anything that is not a BD mobile", () => {
    expect(normaliseBdMobile("0171")).toBeNull(); // too short
    expect(normaliseBdMobile("017123456789")).toBeNull(); // too long
    expect(normaliseBdMobile("01212345678")).toBeNull(); // no operator on 012
    expect(normaliseBdMobile("02712345678")).toBeNull(); // landline, not mobile
    expect(normaliseBdMobile("+14155550132")).toBeNull(); // US
    expect(normaliseBdMobile("hello")).toBeNull();
    expect(normaliseBdMobile("")).toBeNull();
  });
});

describe("isDeliverablePhone", () => {
  it("requires a number", () => {
    // Not optional, because a courier who cannot ring the recipient cannot
    // deliver, and that costs the seller the parcel.
    expect(isDeliverablePhone("", "BD")).toBe(false);
    expect(isDeliverablePhone("   ", "BD")).toBe(false);
    expect(isDeliverablePhone("", "GB")).toBe(false);
  });

  it("enforces the mobile format for Bangladesh", () => {
    expect(isDeliverablePhone("01712345678", "BD")).toBe(true);
    expect(isDeliverablePhone("+8801712345678", "BD")).toBe(true);
    expect(isDeliverablePhone("0171", "BD")).toBe(false);
    expect(isDeliverablePhone("01212345678", "BD")).toBe(false);
  });

  it("does not apply that format to other countries", () => {
    // This shop can claim to know one numbering plan. Applying it worldwide
    // would reject good foreign numbers on a marketplace allowed to ship
    // abroad.
    expect(isDeliverablePhone("+44 20 7946 0958", "GB")).toBe(true);
    expect(isDeliverablePhone("+1 415 555 0132", "US")).toBe(true);
    expect(isDeliverablePhone("0171", "GB")).toBe(true);
  });

  it("is case- and whitespace-insensitive about the country", () => {
    expect(isDeliverablePhone("0171", "bd")).toBe(false);
    expect(isDeliverablePhone("01712345678", " bd ")).toBe(true);
  });
});
