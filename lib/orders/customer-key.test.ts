import { describe, expect, it } from "vitest";
import {
  customerKeyFor,
  customerLabel,
  parseCustomerKey,
} from "./customer-key";

describe("customerKeyFor", () => {
  it("prefers the account, because that is the only proved join", () => {
    expect(
      customerKeyFor({
        buyerId: "01a08972-cd0b-795e-b317-0696713d630c",
        email: "ada@example.com",
        contactPhone: "01712345678",
      }),
    ).toBe("u_01a08972-cd0b-795e-b317-0696713d630c");
  });

  it("falls back to email, then phone", () => {
    expect(
      customerKeyFor({
        buyerId: null,
        email: "ada@example.com",
        contactPhone: "01712345678",
      }),
    ).toMatch(/^e_/);

    expect(
      customerKeyFor({
        buyerId: null,
        email: null,
        contactPhone: "01712345678",
      }),
    ).toBe("p_01712345678");
  });

  /**
   * The grouping this exists for. Two guest orders typed with different casing
   * and stray spaces are one person, and showing them as two would split their
   * history in half.
   */
  it("groups the same address however it was typed", () => {
    const a = customerKeyFor({
      buyerId: null,
      email: "Ada@Example.com",
      contactPhone: null,
    });
    const b = customerKeyFor({
      buyerId: null,
      email: "  ada@example.com  ",
      contactPhone: null,
    });
    expect(a).toBe(b);
  });

  it("keeps different people apart", () => {
    const a = customerKeyFor({
      buyerId: null,
      email: "ada@example.com",
      contactPhone: null,
    });
    const b = customerKeyFor({
      buyerId: null,
      email: "eve@example.com",
      contactPhone: null,
    });
    expect(a).not.toBe(b);
  });

  /**
   * An account and a guest order sharing an address are NOT joined here.
   * Claiming does that, by writing buyerId onto the order — which is a proved
   * act. Doing it in this function would merge on an unproved match.
   */
  it("does not merge an account with a bare address", () => {
    const signedIn = customerKeyFor({
      buyerId: "01a08972-cd0b-795e-b317-0696713d630c",
      email: "ada@example.com",
      contactPhone: null,
    });
    const guest = customerKeyFor({
      buyerId: null,
      email: "ada@example.com",
      contactPhone: null,
    });
    expect(signedIn).not.toBe(guest);
  });

  it("names nobody when the order names nobody", () => {
    expect(
      customerKeyFor({ buyerId: null, email: null, contactPhone: null }),
    ).toBeNull();
    expect(
      customerKeyFor({ buyerId: null, email: "   ", contactPhone: null }),
    ).toBeNull();
  });
});

describe("parseCustomerKey", () => {
  it("round-trips every kind", () => {
    const id = "01a08972-cd0b-795e-b317-0696713d630c";
    expect(
      parseCustomerKey(
        customerKeyFor({ buyerId: id, email: null, contactPhone: null }) ?? "",
      ),
    ).toEqual({ kind: "account", buyerId: id });

    expect(
      parseCustomerKey(
        customerKeyFor({
          buyerId: null,
          email: "ada+tag@example.com",
          contactPhone: null,
        }) ?? "",
      ),
    ).toEqual({ kind: "email", email: "ada+tag@example.com" });

    expect(
      parseCustomerKey(
        customerKeyFor({
          buyerId: null,
          email: null,
          contactPhone: "01712345678",
        }) ?? "",
      ),
    ).toEqual({ kind: "phone", phone: "01712345678" });
  });

  // It arrives from a URL, so it arrives from anyone.
  it("refuses anything malformed rather than guessing", () => {
    expect(parseCustomerKey("")).toBeNull();
    expect(parseCustomerKey("u_")).toBeNull();
    expect(parseCustomerKey("x_whatever")).toBeNull();
    expect(parseCustomerKey("nonsense")).toBeNull();
    expect(parseCustomerKey("e_!!!not-base64!!!")).toBeNull();
  });

  /** A key that decodes to something other than what it encodes is mangled. */
  it("refuses a key that does not round-trip", () => {
    expect(parseCustomerKey("e_YQ")).toEqual({ kind: "email", email: "a" });
    // Padding a base64url value changes it without changing what it decodes to.
    expect(parseCustomerKey("e_YQ==")).toBeNull();
  });
});

describe("customerLabel", () => {
  it("prefers the name a person answers to", () => {
    expect(
      customerLabel({
        recipientName: "Afroza Sultana",
        email: "a@example.com",
        contactPhone: "01712345678",
      }),
    ).toBe("Afroza Sultana");
  });

  it("falls through to whatever contact exists", () => {
    expect(
      customerLabel({
        recipientName: "  ",
        email: "a@example.com",
        contactPhone: null,
      }),
    ).toBe("a@example.com");
    expect(
      customerLabel({
        recipientName: null,
        email: null,
        contactPhone: "01712345678",
      }),
    ).toBe("01712345678");
  });

  it("never renders an empty label", () => {
    expect(
      customerLabel({ recipientName: null, email: null, contactPhone: null }),
    ).toBe("Unknown");
  });
});
