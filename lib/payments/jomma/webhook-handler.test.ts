import { constructEvent, signPayload } from "@jomma/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The webhook route's own logic: idempotency, and which events move money.
 *
 * Everything below the route is mocked, deliberately. The guarantees that live
 * in Postgres — the primary key on jomma_webhook_events, the SELECT ... FOR
 * UPDATE in recordOrderPaid, the unique index on ledger idempotency keys — are
 * the database's to keep and are exercised by the verify scripts against a real
 * instance. What is mocked out here is exactly what is *not* being tested.
 *
 * What IS tested is the part I wrote and could get wrong: that the event id is
 * claimed BEFORE any handler runs, that a replay short-circuits on that claim,
 * and that each event type does the one thing it should.
 */

const SECRET = "whsec_test_only_never_a_real_secret";
const ORDER_ID = "11111111-1111-4111-8111-111111111111";

/** Event ids this fake database has already seen. Stands in for the PK. */
const seenEvents = new Set<string>();

type FakeOrder = {
  id: string;
  status: string;
  totalCents: number;
  orderNumber: string;
};

/** The order findOrder() will return, or null for "no matching order". */
let currentOrder: FakeOrder | null = null;

function makeOrder(overrides: Partial<FakeOrder> = {}): FakeOrder {
  return {
    id: ORDER_ID,
    status: "pending",
    totalCents: 75604,
    orderNumber: "ORD-2026-000123",
    ...overrides,
  };
}

const recordOrderPaid = vi.fn(async () => ({ recorded: true, entries: 2 }));
const recordOrderReversed = vi.fn(async () => ({ recorded: true, entries: 2 }));
const sendOrderConfirmation = vi.fn(async () => {});
const releaseOrderStock = vi.fn(async () => ({ released: true }));
/** The event carries one trx_id; the full breakdown comes from a fetch. */
const fetchAndPersistAppliedPayments = vi.fn(async () => {});

vi.mock("@/lib/db", () => {
  const insert = () => ({
    values: (row: { id: string }) => ({
      onConflictDoNothing: () => ({
        // The whole point: an id already present returns no rows, which is
        // what the route reads as "already delivered".
        returning: async () => {
          if (seenEvents.has(row.id)) return [];
          seenEvents.add(row.id);
          return [{ id: row.id }];
        },
      }),
    }),
  });

  const update = () => ({
    set: () => ({ where: async () => undefined }),
  });

  const select = () => ({
    from: () => ({
      where: () => ({
        limit: async () => (currentOrder ? [currentOrder] : []),
      }),
    }),
  });

  return { db: { insert, update, select } };
});

vi.mock("@/lib/money/ledger", () => ({ recordOrderPaid, recordOrderReversed }));
vi.mock("@/lib/email/notify", () => ({ sendOrderConfirmation }));
vi.mock("@/lib/payments/jomma/release", () => ({ releaseOrderStock }));

/*
  Coverage is asked of the ORDER now, not of the event — an order that expired
  half-paid gets a new intent for the balance, so the event that completes it
  reports the balance and never the total. Driven per test through this handle.
*/
let coverage = {
  totalCents: 75604,
  receivedCents: 75604,
  outstandingCents: 0,
  overpaidCents: 0,
  covered: true,
};
vi.mock("@/lib/payments/jomma/coverage", () => ({
  coverageForOrder: vi.fn(async () => coverage),
}));
vi.mock("@/lib/payments/jomma/sync", () => ({
  fetchAndPersistAppliedPayments,
}));

// The signature check is NOT mocked — the route runs the real constructEvent,
// so these tests would also catch verification being bypassed.
vi.mock("@/lib/payments/jomma/client", () => ({
  jomma: () => ({ webhooks: { construct: constructEvent } }),
  jommaWebhookSecret: () => SECRET,
  jommaConfigured: () => true,
}));

const { POST } = await import("@/app/api/webhooks/jomma/route");

function deliver(
  event: Record<string, unknown>,
  options: { signature?: string | null } = {},
) {
  const raw = JSON.stringify(event);
  const signature =
    options.signature === undefined
      ? signPayload(raw, SECRET)
      : options.signature;

  return POST(
    new Request("https://shop.example.com/api/webhooks/jomma", {
      method: "POST",
      body: raw,
      headers: signature ? { "x-jomma-signature": signature } : {},
    }),
  );
}

function paymentEvent(
  id: string,
  type: string,
  data: Record<string, unknown> = {},
) {
  return {
    id,
    type,
    created_at: new Date().toISOString(),
    data: {
      intent_id: "int_test_1",
      client_reference: ORDER_ID,
      amount: 75604,
      received_amount: 75604,
      trx_id: "TRX123",
      sender_msisdn: "8801700000000",
      ...data,
    },
  };
}

beforeEach(() => {
  seenEvents.clear();
  vi.clearAllMocks();
  currentOrder = makeOrder();
  coverage = {
    totalCents: 75604,
    receivedCents: 75604,
    outstandingCents: 0,
    overpaidCents: 0,
    covered: true,
  };
});

describe("jomma webhook handler", () => {
  it("marks an order paid on payment.succeeded", async () => {
    const response = await deliver(paymentEvent("evt_1", "payment.succeeded"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      received: true,
      handled: true,
    });
    expect(recordOrderPaid).toHaveBeenCalledTimes(1);
    expect(recordOrderPaid).toHaveBeenCalledWith(expect.anything(), {
      orderId: ORDER_ID,
      paymentIntentId: "int_test_1",
    });
    expect(sendOrderConfirmation).toHaveBeenCalledTimes(1);
  });

  it("stores the transfers behind the event, not just its own trx_id", async () => {
    await deliver(paymentEvent("evt_split", "payment.succeeded"));

    // The event names one TrxID. On a split payment that is only whichever
    // transfer completed the intent, so the record has to come from a fetch.
    expect(fetchAndPersistAppliedPayments).toHaveBeenCalledWith(
      ORDER_ID,
      "int_test_1",
    );
  });

  it("still fulfils when the transfer breakdown cannot be fetched", async () => {
    fetchAndPersistAppliedPayments.mockRejectedValueOnce(
      new Error("jomma down"),
    );

    const response = await deliver(
      paymentEvent("evt_degraded", "payment.succeeded"),
    );

    // Losing the breakdown is recoverable — the order page fetches it again.
    // Refusing to fulfil an order Jomma has confirmed is not.
    expect(response.status).toBe(200);
    expect(recordOrderPaid).toHaveBeenCalledTimes(1);
  });

  it("records the transfers behind a partial payment too", async () => {
    await deliver(
      paymentEvent("evt_partial_store", "payment.partial", {
        received_amount: 40000,
        shortfall: 35604,
      }),
    );

    // The buyer needs to see what arrived while they still owe the balance.
    expect(fetchAndPersistAppliedPayments).toHaveBeenCalledOnce();
    expect(recordOrderPaid).not.toHaveBeenCalled();
  });

  it("is idempotent when the same event is redelivered", async () => {
    const event = paymentEvent("evt_replay", "payment.succeeded");

    const first = await deliver(event);
    const second = await deliver(event);
    const third = await deliver(event);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(200);

    // 200 on the replays, so Jomma stops retrying rather than backing off.
    expect(await second.json()).toMatchObject({
      received: true,
      duplicate: true,
    });

    // The actual money-safety property: one delivery, one credit, one receipt.
    // Three deliveries of one payment must not ship twice or count revenue
    // twice.
    expect(recordOrderPaid).toHaveBeenCalledTimes(1);
    expect(sendOrderConfirmation).toHaveBeenCalledTimes(1);
  });

  it("treats two different events for one order as two events", async () => {
    // The dedupe key is the event id, not the order — a partial payment
    // followed by the balance is two real events on one order and both must
    // run.
    await deliver(
      paymentEvent("evt_a", "payment.partial", {
        received_amount: 50000,
        shortfall: 25604,
      }),
    );
    await deliver(paymentEvent("evt_b", "payment.succeeded"));

    expect(recordOrderPaid).toHaveBeenCalledTimes(1);
  });

  it("rejects a forged signature before touching the database", async () => {
    const response = await deliver(
      paymentEvent("evt_forged", "payment.succeeded"),
      {
        signature: signPayload(
          JSON.stringify(paymentEvent("evt_forged", "payment.succeeded")),
          "whsec_wrong",
        ),
      },
    );

    expect(response.status).toBe(400);
    expect(recordOrderPaid).not.toHaveBeenCalled();
    // Nothing was recorded, so a later genuine delivery of this id still works.
    expect(seenEvents.size).toBe(0);
  });

  it("rejects a missing signature", async () => {
    const response = await deliver(
      paymentEvent("evt_nosig", "payment.succeeded"),
      {
        signature: null,
      },
    );

    expect(response.status).toBe(400);
    expect(recordOrderPaid).not.toHaveBeenCalled();
  });

  it("does not fulfil on payment.partial", async () => {
    const response = await deliver(
      paymentEvent("evt_partial", "payment.partial", {
        received_amount: 50000,
        shortfall: 25604,
      }),
    );

    expect(response.status).toBe(200);
    expect(recordOrderPaid).not.toHaveBeenCalled();
    expect(sendOrderConfirmation).not.toHaveBeenCalled();
  });

  it("fulfils on payment.overpaid and flags the excess", async () => {
    const response = await deliver(
      paymentEvent("evt_over", "payment.overpaid", {
        received_amount: 80000,
        excess: 4396,
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      reason: "overpaid, refund owed",
    });
    expect(recordOrderPaid).toHaveBeenCalledTimes(1);
  });

  it("refuses to fulfil an order the money does not cover", async () => {
    /*
      The guard that catches a bug in our own amount handling before it becomes
      a shipped parcel. It used to compare this event's `received_amount` to the
      order total for exact equality; it now asks whether everything the order
      has received adds up, because a top-up intent never reports the total.
      Same protection, one level up.
    */
    coverage = {
      totalCents: 75604,
      receivedCents: 1,
      outstandingCents: 75603,
      overpaidCents: 0,
      covered: false,
    };

    const response = await deliver(
      paymentEvent("evt_mismatch", "payment.succeeded", { received_amount: 1 }),
    );

    expect(await response.json()).toMatchObject({
      handled: false,
      reason: "not covered",
    });
    expect(recordOrderPaid).not.toHaveBeenCalled();
  });

  it("un-fulfils on payment.reversed", async () => {
    currentOrder = makeOrder({ status: "paid" });

    const response = await deliver(
      paymentEvent("evt_rev", "payment.reversed", {
        reason: "sender disputed",
      }),
    );

    expect(response.status).toBe(200);
    expect(recordOrderReversed).toHaveBeenCalledWith(expect.anything(), {
      orderId: ORDER_ID,
      reason: "sender disputed",
      eventId: "evt_rev",
    });
  });

  /**
   * An expired intent used to release the stock and end the order. It no longer
   * does: a buyer can now come back and finish paying for a full day, so an
   * intent timing out is a payment window closing, not a buyer giving up.
   * Expiry is decided in one place — the sweep in lib/orders/confirmation.ts —
   * because two things racing to decide when an order dies is how one of them
   * starts killing orders somebody has already paid for.
   */
  it("leaves a pending order alone on payment.expired, so it stays resumable", async () => {
    const response = await deliver(paymentEvent("evt_exp", "payment.expired"));

    expect(releaseOrderStock).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      handled: true,
      reason: "resumable until the sweep",
    });

    // A paid order must never be unwound by a stale expiry arriving late.
    vi.clearAllMocks();
    currentOrder = makeOrder({ status: "paid" });
    const paid = await deliver(paymentEvent("evt_exp2", "payment.expired"));

    expect(releaseOrderStock).not.toHaveBeenCalled();
    expect(await paid.json()).toMatchObject({ handled: false });
  });

  it("logs account events without touching any order", async () => {
    const response = await deliver({
      id: "evt_acct",
      type: "account.degraded",
      created_at: new Date().toISOString(),
      data: { provider: "bkash", msisdn: "8801700000000" },
    });

    expect(response.status).toBe(200);
    expect(recordOrderPaid).not.toHaveBeenCalled();
    expect(releaseOrderStock).not.toHaveBeenCalled();
  });

  it("acknowledges an event for an order it cannot find", async () => {
    currentOrder = null;

    const response = await deliver(
      paymentEvent("evt_orphan", "payment.succeeded"),
    );

    // 200, not 404 — retrying an order we do not have will never resolve.
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      handled: false,
      reason: "no matching order",
    });
  });
});
