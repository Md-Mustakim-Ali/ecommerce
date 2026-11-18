import type { Intent } from "@jomma/sdk";
import { JommaError } from "@jomma/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The pull half of the integration: asking Jomma what happened, rather than
 * waiting to be told.
 *
 * These are the cases that cannot be produced by clicking. A partial payment
 * needs somebody to underpay a real order from a real handset; a split needs
 * them to do it twice. Both are ordinary in a Send Money flow and both were
 * previously dead ends in this application, so they are the ones worth pinning
 * down in a test rather than in a manual pass.
 *
 * The database is mocked for the same reason the webhook route's tests mock it:
 * the guarantees that live in Postgres — the unique index that makes re-syncing
 * idempotent, the SELECT ... FOR UPDATE inside recordOrderPaid — are the
 * database's to keep. What is tested here is the decision-making above them.
 */

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const INTENT_ID = "int_test_sync_1";

type FakeOrder = {
  id: string;
  status: string;
  totalCents: number;
  paymentIntentId: string | null;
};

let currentOrder: FakeOrder;
/** Rows the code under test has "written". Stands in for the table. */
let storedPayments: Record<string, unknown>[];
/** Every row handed to insert(), including ones a real unique index would drop. */
let insertAttempts: Record<string, unknown>[][];

const recordOrderPaid = vi.fn(async () => ({ recorded: true, entries: 2 }));
const sendOrderConfirmation = vi.fn(async () => {});
const intentsGet = vi.fn<(id: string) => Promise<Intent>>();

vi.mock("@/lib/db", () => {
  const select = () => ({
    from: () => ({
      where: () => ({
        // The order lookup ends in .limit(); the stored-payments read ends in
        // .orderBy(). Distinct terminals, so the fake can tell them apart.
        limit: async () => [currentOrder],
        orderBy: async () => storedPayments,
      }),
    }),
  });

  const insert = () => ({
    values: (rows: Record<string, unknown>[]) => ({
      onConflictDoNothing: async () => {
        insertAttempts.push(rows);
        for (const row of rows) {
          // Mirrors the unique index: (intent_id, coalesce(trx_id,''), applied_at).
          const key = `${row.intentId}|${row.trxId ?? ""}|${(row.appliedAt as Date).toISOString()}`;
          if (!storedPayments.some((held) => held.__key === key)) {
            storedPayments.push({ ...row, __key: key });
          }
        }
      },
    }),
  });

  return { db: { select, insert } };
});

vi.mock("@/lib/money/ledger", () => ({ recordOrderPaid }));
vi.mock("@/lib/email/notify", () => ({ sendOrderConfirmation }));
vi.mock("@/lib/payments/jomma/client", () => ({
  jomma: () => ({
    intents: { get: intentsGet },
    payUrl: (id: string) => `https://jomma.test/pay/${id}`,
  }),
}));

const { syncOrderPayment } = await import("@/lib/payments/jomma/sync");

function makeIntent(overrides: Partial<Intent> = {}): Intent {
  return {
    id: INTENT_ID,
    status: "matched",
    amount: 75604,
    received_amount: 75604,
    ref_code: "XCUYVGVE",
    receiving_account: {
      provider: "bkash",
      msisdn: "01700000000",
      display_name: "Shop",
    },
    client_reference: ORDER_ID,
    payments: [],
    shortfall: 0,
    excess: 0,
    metadata: {},
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    created_at: new Date().toISOString(),
    request_id: "req_test",
    ...overrides,
  };
}

function transfer(overrides: Record<string, unknown> = {}) {
  return {
    trx_id: "TRX111",
    sender_msisdn: "8801711111111",
    amount: 75604,
    occurred_at: "2026-09-09T10:00:00.000Z",
    applied_at: "2026-09-09T10:00:05.000Z",
    match_confidence: "exact" as const,
    matched_by: "automatic" as const,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  storedPayments = [];
  insertAttempts = [];
  currentOrder = {
    id: ORDER_ID,
    status: "pending",
    totalCents: 75604,
    paymentIntentId: INTENT_ID,
  };
  recordOrderPaid.mockResolvedValue({ recorded: true, entries: 2 });
});

describe("syncOrderPayment", () => {
  it("settles a pending order Jomma reports as matched", async () => {
    intentsGet.mockResolvedValue(makeIntent({ payments: [transfer()] }));

    const snapshot = await syncOrderPayment(ORDER_ID);

    expect(recordOrderPaid).toHaveBeenCalledWith(expect.anything(), {
      orderId: ORDER_ID,
      paymentIntentId: INTENT_ID,
    });
    expect(sendOrderConfirmation).toHaveBeenCalledOnce();
    expect(snapshot.orderStatus).toBe("paid");
    expect(snapshot.reachable).toBe(true);
  });

  /*
    The reason this module exists. Before it, an order whose webhook never
    arrived stayed pending forever with no code path that could notice.
  */
  it("settles an order whose webhook never arrived", async () => {
    intentsGet.mockResolvedValue(makeIntent({ payments: [transfer()] }));

    const snapshot = await syncOrderPayment(ORDER_ID);

    expect(snapshot.orderStatus).toBe("paid");
  });

  it("does not settle a partial payment, and reports the shortfall", async () => {
    intentsGet.mockResolvedValue(
      makeIntent({
        status: "partial",
        received_amount: 40000,
        shortfall: 35604,
        payments: [transfer({ amount: 40000 })],
      }),
    );

    const snapshot = await syncOrderPayment(ORDER_ID);

    expect(recordOrderPaid).not.toHaveBeenCalled();
    expect(sendOrderConfirmation).not.toHaveBeenCalled();
    expect(snapshot.orderStatus).toBe("pending");
    expect(snapshot.shortfallCents).toBe(35604);
    // The buyer needs somewhere to send the balance.
    expect(snapshot.payUrl).toContain(INTENT_ID);
  });

  it("keeps every transfer of a split payment, not just the last", async () => {
    intentsGet.mockResolvedValue(
      makeIntent({
        payments: [
          transfer({
            trx_id: "TRX111",
            amount: 40000,
            applied_at: "2026-09-09T10:00:05.000Z",
          }),
          transfer({
            trx_id: "TRX222",
            amount: 35604,
            sender_msisdn: "8801822222222",
            applied_at: "2026-09-09T10:04:00.000Z",
          }),
        ],
      }),
    );

    const snapshot = await syncOrderPayment(ORDER_ID);

    expect(snapshot.payments).toHaveLength(2);
    expect(snapshot.payments.map((p) => p.trxId)).toEqual(["TRX111", "TRX222"]);
    // Two different handsets paid for one order. Both are on the record.
    expect(snapshot.payments.map((p) => p.senderMsisdn)).toEqual([
      "8801711111111",
      "8801822222222",
    ]);
    expect(
      snapshot.payments.reduce((total, p) => total + p.amountCents, 0),
    ).toBe(75604);
  });

  it("does not duplicate transfers when polled repeatedly", async () => {
    intentsGet.mockResolvedValue(makeIntent({ payments: [transfer()] }));

    await syncOrderPayment(ORDER_ID);
    currentOrder.status = "paid";
    await syncOrderPayment(ORDER_ID);
    await syncOrderPayment(ORDER_ID);

    // Offered every time — the guard is the unique index, not a pre-check.
    expect(insertAttempts).toHaveLength(3);
    expect(storedPayments).toHaveLength(1);
  });

  it("stores a transfer with no TrxID exactly once", async () => {
    // An admin-resolved payment has no provider transaction id. A plain unique
    // index would treat each NULL as distinct and insert it again per poll.
    intentsGet.mockResolvedValue(
      makeIntent({
        payments: [transfer({ trx_id: null, matched_by: "admin" })],
      }),
    );

    await syncOrderPayment(ORDER_ID);
    await syncOrderPayment(ORDER_ID);

    expect(storedPayments).toHaveLength(1);
  });

  /*
    A contradiction: Jomma says matched, and in the same breath reports less
    money than the order costs. Whichever half is wrong, shipping is the wrong
    response to it — and the status check alone would let this through, so the
    received-amount guard has to stand on its own.
  */
  it("refuses to settle a matched intent that received less than the total", async () => {
    intentsGet.mockResolvedValue(
      makeIntent({ status: "matched", received_amount: 40000 }),
    );

    const snapshot = await syncOrderPayment(ORDER_ID);

    expect(recordOrderPaid).not.toHaveBeenCalled();
    expect(sendOrderConfirmation).not.toHaveBeenCalled();
    expect(snapshot.orderStatus).toBe("pending");
  });

  it("refuses to settle when the intent was raised for a different amount", async () => {
    intentsGet.mockResolvedValue(
      makeIntent({ amount: 10000, received_amount: 10000 }),
    );

    const snapshot = await syncOrderPayment(ORDER_ID);

    expect(recordOrderPaid).not.toHaveBeenCalled();
    expect(snapshot.orderStatus).toBe("pending");
  });

  /*
    Money against a dead intent.

    Jomma expired or cancelled the request and the full amount is nonetheless
    sitting against it — a transfer that landed after the TTL, or a cancellation
    that raced an incoming payment. The amount guard alone would happily ship
    this. It must not: the intent is closed, the stock it reserved may already
    have been released to somebody else, and reconciling it is a decision for a
    person. The buyer is told to contact support instead, and the money is
    visibly not lost.
  */
  it("does not auto-settle money that arrived against a dead intent", async () => {
    for (const status of ["expired", "cancelled"] as const) {
      vi.clearAllMocks();
      currentOrder.status = "pending";
      intentsGet.mockResolvedValue(
        makeIntent({ status, received_amount: 75604 }),
      );

      const snapshot = await syncOrderPayment(ORDER_ID);

      expect(recordOrderPaid).not.toHaveBeenCalled();
      expect(snapshot.orderStatus).toBe("pending");
      expect(snapshot.receivedCents).toBe(75604);
    }
  });

  it("settles an overpayment and reports the excess owed back", async () => {
    intentsGet.mockResolvedValue(
      makeIntent({ status: "over", received_amount: 80000, excess: 4396 }),
    );

    const snapshot = await syncOrderPayment(ORDER_ID);

    expect(recordOrderPaid).toHaveBeenCalledOnce();
    expect(snapshot.excessCents).toBe(4396);
  });

  it("does not re-settle or re-email an order that is already paid", async () => {
    currentOrder.status = "paid";
    intentsGet.mockResolvedValue(makeIntent({ payments: [transfer()] }));

    const snapshot = await syncOrderPayment(ORDER_ID);

    expect(recordOrderPaid).not.toHaveBeenCalled();
    expect(sendOrderConfirmation).not.toHaveBeenCalled();
    expect(snapshot.orderStatus).toBe("paid");
  });

  /*
    Degrading rather than throwing matters here: this runs from a page and from
    a poller, so an exception would replace the buyer's order with an error
    boundary because a payment provider had a bad minute.
  */
  it("reports unreachable instead of throwing when Jomma is down", async () => {
    intentsGet.mockRejectedValue(
      new JommaError({
        code: "internal_error",
        message: "boom",
        status: 500,
      }),
    );

    const snapshot = await syncOrderPayment(ORDER_ID);

    expect(snapshot.reachable).toBe(false);
    expect(snapshot.orderStatus).toBe("pending");
    expect(recordOrderPaid).not.toHaveBeenCalled();
  });

  it("never asks Jomma about an order that has no Jomma intent", async () => {
    currentOrder.paymentIntentId = "manual_59090e6569c1";

    const snapshot = await syncOrderPayment(ORDER_ID);

    expect(intentsGet).not.toHaveBeenCalled();
    expect(snapshot.reachable).toBe(false);
    expect(snapshot.intentStatus).toBeNull();
  });

  /*
    The state this Jomma instance actually returns.

    Intents whose `expires_at` passed over a day ago still come back labelled
    `open`, and no `payment.expired` webhook was ever delivered for them. Taking
    the label at face value would leave the buyer polling a request that can
    never settle — the original bug, reintroduced from the other side.
  */
  it("treats a long-past deadline as expired even when Jomma still says open", async () => {
    intentsGet.mockResolvedValue(
      makeIntent({
        status: "open",
        received_amount: 0,
        shortfall: 75604,
        expires_at: new Date(Date.now() - 86_400_000).toISOString(),
      }),
    );

    const snapshot = await syncOrderPayment(ORDER_ID);

    expect(snapshot.expired).toBe(true);
    // No point sending them to a pay page that cannot take the money.
    expect(snapshot.payUrl).toBeNull();
  });

  it("does not write off a lapsed intent that is holding money", async () => {
    intentsGet.mockResolvedValue(
      makeIntent({
        status: "open",
        received_amount: 40000,
        shortfall: 35604,
        expires_at: new Date(Date.now() - 86_400_000).toISOString(),
      }),
    );

    const snapshot = await syncOrderPayment(ORDER_ID);

    // Somebody's ৳400 is sitting against this. Calling it expired would tell
    // them nothing arrived when something did.
    expect(snapshot.expired).toBe(false);
    expect(snapshot.receivedCents).toBe(40000);
  });

  it("keeps waiting on an intent that is still within its deadline", async () => {
    intentsGet.mockResolvedValue(
      makeIntent({ status: "open", received_amount: 0, shortfall: 75604 }),
    );

    const snapshot = await syncOrderPayment(ORDER_ID);

    expect(snapshot.expired).toBe(false);
    expect(snapshot.payUrl).toContain(INTENT_ID);
  });

  it("stops offering a pay link once there is nothing left to pay", async () => {
    intentsGet.mockResolvedValue(makeIntent({ status: "matched" }));

    const snapshot = await syncOrderPayment(ORDER_ID);

    expect(snapshot.payUrl).toBeNull();
  });

  /**
   * The link that was handed out dead.
   *
   * `expired` deliberately stays false for an intent past its deadline that is
   * holding money — writing that off would tell a buyer nothing arrived when
   * something did. payUrl used to be keyed on `expired`, so the one buyer most
   * likely to need a payment link (part-paid, clock run out) was the one
   * offered a link to a pay page that no longer works. They pressed it and it
   * failed.
   *
   * Their route is a new intent for the balance, via /api/orders/pay. Nothing
   * here should offer a URL at all.
   */
  it("offers no pay link for a lapsed intent, even one holding money", async () => {
    intentsGet.mockResolvedValue(
      makeIntent({
        status: "partial",
        received_amount: 11000,
        shortfall: 700,
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      }),
    );

    const snapshot = await syncOrderPayment(ORDER_ID);

    expect(snapshot.payUrl).toBeNull();
    // Still not written off — the money is real and the buyer must see it.
    expect(snapshot.expired).toBe(false);
    expect(snapshot.receivedCents).toBe(11000);
  });

  it("still offers one while the intent is genuinely live", async () => {
    intentsGet.mockResolvedValue(
      makeIntent({
        status: "partial",
        received_amount: 11000,
        shortfall: 700,
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      }),
    );

    const snapshot = await syncOrderPayment(ORDER_ID);

    expect(snapshot.payUrl).not.toBeNull();
  });
});
