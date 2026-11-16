import { beforeAll, describe, expect, it } from "vitest";
import { verifyOrderAccess } from "../orders/access";

/**
 * The links in transactional mail have to open for a signed-out buyer.
 *
 * That is not decoration. Guest checkout is allowed, so the recipient of a
 * receipt frequently has no account — and until this was fixed, every one of
 * these links landed on a sign-in page, because `/orders` was behind a session
 * check. The order id alone is not enough to get in either, by design. So the
 * URL has to carry the signed token, and nothing but a test will notice if
 * somebody later simplifies it back to `/orders/${id}`.
 *
 * Imported dynamically because lib/email/templates.ts reaches lib/env, which
 * parses the whole environment at module load.
 */
type Templates = typeof import("./templates");
let templates: Templates;

const ORDER_ID = "01a08972-cd0b-795e-b317-0696713d630c";

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/db";
  process.env.BETTER_AUTH_SECRET ??= "test-secret-not-the-real-one-0123456789";
  process.env.BETTER_AUTH_URL ??= "https://shop.example.com";
  templates = await import("./templates");
});

/** Pulls the order link out of the text part, which is written first. */
function orderLink(text: string): string | undefined {
  return text.match(/https:\/\/shop\.example\.com\/orders\/[^\s)]+/)?.[0];
}

function assertOpensForAGuest(text: string) {
  const link = orderLink(text);
  expect(link, "no order link in the message").toBeTruthy();

  const url = new URL(link as string);
  expect(url.pathname).toBe(`/orders/${ORDER_ID}`);
  expect(verifyOrderAccess(ORDER_ID, url.searchParams.get("t"))).toBe(true);
}

describe("order links in transactional mail", () => {
  it("the receipt opens for a signed-out buyer", () => {
    const message = templates.orderConfirmation({
      to: "buyer@example.com",
      orderNumber: "ORD-2026-000123",
      orderId: ORDER_ID,
      currency: "BDT",
      totalCents: 31200,
      lines: [
        {
          title: "Merino wool over-ear headphones",
          variantLabel: "Navy",
          quantity: 1,
          lineTotalCents: 31200,
        },
      ],
      storeCount: 1,
    });

    assertOpensForAGuest(message.text);
    expect(message.html).toContain(`/orders/${ORDER_ID}?t=`);
  });

  it("the shipment notice opens for a signed-out buyer", () => {
    const message = templates.shipmentNotice({
      to: "buyer@example.com",
      orderNumber: "ORD-2026-000123",
      orderId: ORDER_ID,
      storeName: "Northmark Supply",
      carrier: "Pathao",
      trackingNumber: "PT-99",
    });

    assertOpensForAGuest(message.text);
  });

  it("a message from the seller opens for a signed-out buyer", () => {
    const message = templates.buyerMessageNotice({
      to: "buyer@example.com",
      orderNumber: "ORD-2026-000123",
      orderId: ORDER_ID,
      storeName: "Northmark Supply",
      body: "Your parcel goes out tomorrow.",
    });

    assertOpensForAGuest(message.text);
  });

  it("the token is specific to the order in the link", () => {
    const message = templates.orderConfirmation({
      to: "buyer@example.com",
      orderNumber: "ORD-2026-000123",
      orderId: ORDER_ID,
      currency: "BDT",
      totalCents: 100,
      lines: [
        {
          title: "A thing",
          variantLabel: null,
          quantity: 1,
          lineTotalCents: 100,
        },
      ],
      storeCount: 1,
    });

    const token = new URL(orderLink(message.text) as string).searchParams.get(
      "t",
    );
    const somebodyElse = "01a08971-667a-7ee4-8e21-a2ff569d925f";
    expect(verifyOrderAccess(somebodyElse, token)).toBe(false);
  });
});
