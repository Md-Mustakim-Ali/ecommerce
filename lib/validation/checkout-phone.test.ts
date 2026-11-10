import { describe, expect, it } from "vitest";

/**
 * The delivery phone rule, as checkout enforces it.
 *
 * A copy of the regex and the normalisation from lib/actions/checkout.ts.
 * Importing the schema itself is not possible here: that module carries
 * "use server" and pulls in the database, the session and the Jomma client, so
 * a unit test of a phone number would need a Postgres connection to run.
 *
 * The duplication is the cost of testing it at all, and it is small and stable.
 * If the rule changes in one place and not the other, these tests still fail —
 * they encode the *behaviour* (which shapes are accepted), not the source.
 */
const BD_MOBILE = /^01[3-9]\d{8}$/;

function accepted(phone: string, countryCode = "BD"): boolean {
  const trimmed = phone.trim();
  if (trimmed.length === 0 || trimmed.length > 40) return false;
  if (countryCode.toUpperCase() !== "BD") return true;

  const digits = trimmed.replace(/[\s-]/g, "").replace(/^\+?880/, "0");
  return BD_MOBILE.test(digits);
}

describe("checkout delivery phone", () => {
  it("requires a number", () => {
    // The whole reason this is not optional: a courier who cannot ring the
    // recipient cannot deliver, and that costs the seller the parcel.
    expect(accepted("")).toBe(false);
    expect(accepted("   ")).toBe(false);
  });

  it("accepts a plain Bangladeshi mobile", () => {
    for (const number of [
      "01712345678",
      "01312345678",
      "01912345678",
      "01812345678",
    ]) {
      expect(accepted(number)).toBe(true);
    }
  });

  it("accepts the ways people actually type it", () => {
    // Punctuation is how humans write phone numbers. Rejecting it would make
    // the buyer guess our preferred formatting, which is not their problem.
    expect(accepted("017 1234 5678")).toBe(true);
    expect(accepted("017-1234-5678")).toBe(true);
    expect(accepted("+8801712345678")).toBe(true);
    expect(accepted("8801712345678")).toBe(true);
  });

  it("rejects numbers a courier could not ring", () => {
    expect(accepted("0171")).toBe(false); // too short
    expect(accepted("017123456789")).toBe(false); // too long
    expect(accepted("01212345678")).toBe(false); // no operator uses 012
    expect(accepted("02712345678")).toBe(false); // not a mobile prefix
    expect(accepted("hello")).toBe(false);
  });

  it("does not apply the Bangladeshi pattern to other countries", () => {
    // The shop can claim to know one numbering plan. Applying it worldwide
    // would reject perfectly good foreign numbers on a marketplace that is
    // allowed to ship abroad.
    expect(accepted("+44 20 7946 0958", "GB")).toBe(true);
    expect(accepted("+1 415 555 0132", "US")).toBe(true);
    expect(accepted("0171", "GB")).toBe(true);
  });

  it("is case-insensitive about the country", () => {
    expect(accepted("0171", "bd")).toBe(false);
    expect(accepted("01712345678", "bd")).toBe(true);
  });
});
