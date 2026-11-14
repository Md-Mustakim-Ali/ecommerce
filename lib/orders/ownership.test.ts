import { describe, expect, it } from "vitest";
import { contactsFromSession, orderBelongsTo } from "./ownership";

const guestOrder = {
  buyerId: null,
  email: "ada@example.com",
  contactPhone: "01712345678",
};

describe("orderBelongsTo", () => {
  it("recognises the account the order is attached to", () => {
    expect(
      orderBelongsTo(
        { ...guestOrder, buyerId: "user_1" },
        { userId: "user_1" },
      ),
    ).toBe(true);
  });

  it("refuses a different account", () => {
    expect(
      orderBelongsTo(
        { ...guestOrder, buyerId: "user_1" },
        { userId: "user_2" },
      ),
    ).toBe(false);
  });

  it("recognises the email it was placed with, whatever the casing", () => {
    expect(orderBelongsTo(guestOrder, { email: "ADA@Example.com " })).toBe(
      true,
    );
  });

  it("recognises the phone it was placed with, however it is written", () => {
    for (const typed of ["01712345678", "+8801712345678", "017 1234 5678"]) {
      expect(orderBelongsTo(guestOrder, { phone: typed })).toBe(true);
    }
  });

  it("refuses a contact the order does not carry", () => {
    expect(orderBelongsTo(guestOrder, { email: "eve@example.com" })).toBe(
      false,
    );
    expect(orderBelongsTo(guestOrder, { phone: "01812345678" })).toBe(false);
  });

  /**
   * The case that matters most. An order placed with only a number must not be
   * openable by someone who happens to have no email either — two nulls are
   * not a match, and a comparison that treated them as one would hand every
   * phone-only order to every buyer who left the address field blank.
   */
  it("never matches an absent contact against an absent contact", () => {
    const phoneOnly = {
      buyerId: null,
      email: null,
      contactPhone: "01712345678",
    };
    expect(orderBelongsTo(phoneOnly, { email: null })).toBe(false);
    expect(orderBelongsTo(phoneOnly, {})).toBe(false);

    const emailOnly = {
      buyerId: null,
      email: "ada@example.com",
      contactPhone: null,
    };
    expect(orderBelongsTo(emailOnly, { phone: null })).toBe(false);
    expect(orderBelongsTo(emailOnly, {})).toBe(false);
  });

  it("never matches a null account id against an unclaimed order", () => {
    // `buyerId: null` on both sides is the state every guest order is in.
    expect(orderBelongsTo(guestOrder, { userId: null })).toBe(false);
  });

  it("refuses a number that is not a valid mobile even if it looks close", () => {
    // Canonicalisation returns null, which must not then compare equal to the
    // stored number by some accident of coercion.
    expect(orderBelongsTo(guestOrder, { phone: "0171234" })).toBe(false);
  });
});

describe("contactsFromSession", () => {
  it("passes a real address through", () => {
    expect(
      contactsFromSession({
        user: { id: "user_1", email: "ada@example.com", phoneNumber: null },
      }),
    ).toEqual({ userId: "user_1", email: "ada@example.com", phone: null });
  });

  it("drops the placeholder address a phone-only account carries", () => {
    expect(
      contactsFromSession({
        user: {
          id: "user_1",
          email: "01712345678@phone.invalid",
          phoneNumber: "01712345678",
        },
      }),
    ).toEqual({ userId: "user_1", email: null, phone: "01712345678" });
  });

  it("does not let one placeholder account match another's order", () => {
    const contacts = contactsFromSession({
      user: {
        id: "user_1",
        email: "01712345678@phone.invalid",
        phoneNumber: "01712345678",
      },
    });

    // An order that somehow carried a placeholder address must not match on it.
    expect(
      orderBelongsTo(
        {
          buyerId: null,
          email: "01712345678@phone.invalid",
          contactPhone: null,
        },
        contacts,
      ),
    ).toBe(false);
  });
});
