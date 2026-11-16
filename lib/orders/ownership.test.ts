import { beforeAll, describe, expect, it } from "vitest";
import { signOrderAccess } from "./access";
import { claimantFrom, contactsFromSession, orderBelongsTo } from "./ownership";

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET = "test-secret-not-the-real-one-0123456789";
});

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

/**
 * The bug this exists to stop coming back.
 *
 * A guest paid on Jomma, came back to their own order page, and the waiting
 * card told them to sign in — for an account they had never created — while
 * their money sat applied against the order. The page had authorised them by
 * token; the server action behind the card opened with "no session, no answer"
 * and never looked at one.
 */
describe("claimantFrom", () => {
  const ORDER = "01a089d3-c8e2-7d38-a54e-a056cfde3315";
  const order = { ...guestOrder, id: ORDER };

  it("lets a guest holding this order's token through", () => {
    expect(
      orderBelongsTo(order, claimantFrom(null, signOrderAccess(ORDER))),
    ).toBe(true);
  });

  it("still refuses a guest with no token at all", () => {
    expect(orderBelongsTo(order, claimantFrom(null))).toBe(false);
    expect(orderBelongsTo(order, claimantFrom(null, ""))).toBe(false);
    expect(orderBelongsTo(order, claimantFrom(null, "not-a-token"))).toBe(
      false,
    );
  });

  it("refuses a token minted for somebody else's order", () => {
    const other = "01a08971-667a-7ee4-8e21-a2ff569d925f";
    expect(
      orderBelongsTo(order, claimantFrom(null, signOrderAccess(other))),
    ).toBe(false);
  });

  it("keeps recognising a session, with or without a token beside it", () => {
    const session = {
      user: { id: "user_1", email: "ada@example.com", phoneNumber: null },
    };
    // Matched on the order's email, since this account does not own it yet.
    expect(orderBelongsTo(order, claimantFrom(session))).toBe(true);
    expect(orderBelongsTo(order, claimantFrom(session, "junk"))).toBe(true);
  });

  /**
   * A session belonging to someone else must not be widened by a bad token,
   * and a bad token must not be rescued by an unrelated session.
   */
  it("does not let a wrong session and a wrong token add up to access", () => {
    const stranger = {
      user: { id: "user_2", email: "eve@example.com", phoneNumber: null },
    };
    expect(orderBelongsTo(order, claimantFrom(stranger, "junk"))).toBe(false);
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
