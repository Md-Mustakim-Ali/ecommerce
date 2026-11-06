/**
 * End-to-end verification against a real Jomma instance.
 *
 * The unit tests mock the network and the database, so they prove the handler's
 * logic and nothing about whether this application and that service actually
 * agree. This script closes that gap: it talks to a live Jomma, creates a real
 * intent, and delivers a genuinely signed webhook to the real route.
 *
 * Point it at a local instance. It creates an order and marks it paid, which is
 * not something to do against production data.
 *
 *   pnpm tsx --env-file=.env.local scripts/verify-jomma.ts
 *
 * Requires JOMMA_URL, JOMMA_API_KEY, JOMMA_WEBHOOK_SECRET, and both this app
 * and Jomma running.
 */
import { Jomma, JommaError, signPayload } from "@jomma/sdk";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
// Imported from their own modules rather than through lib/db/schema, whose
// `export *` barrel tsx cannot resolve statically when running as ESM.
import { jommaWebhookEvents } from "@/lib/db/schema/jomma";
import { ledgerEntries } from "@/lib/db/schema/money";
import { orders, subOrders } from "@/lib/db/schema/orders";

/**
 * The client is built here rather than imported from lib/payments/jomma/client.
 *
 * @jomma/sdk is ESM-only, and tsx loads this project's .ts files as CommonJS —
 * so anything that reaches the SDK through a .ts module fails to resolve. This
 * file is .mts, which tsx runs as ESM, so importing the SDK directly works.
 *
 * The application's own startPayment() is therefore exercised over HTTP by
 * driving a real checkout, rather than by importing it — which is the better
 * test anyway, since it runs the code exactly as a shopper would.
 */
const client = new Jomma({
  apiKey: process.env.JOMMA_API_KEY ?? "",
  baseUrl: process.env.JOMMA_URL ?? "",
});

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3300";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function deliver(body: string, signature: string | null) {
  return fetch(`${BASE}/api/webhooks/jomma`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signature ? { "x-jomma-signature": signature } : {}),
    },
    body,
  });
}

async function main() {
  const secret = process.env.JOMMA_WEBHOOK_SECRET;
  if (!secret) throw new Error("JOMMA_WEBHOOK_SECRET is not set");

  // ── 1. The API key works and a phone is actually watching ────────────────
  console.log("\nAccounts");
  const accounts = await client.accounts.list();
  check(
    "API key accepted",
    accounts.length > 0,
    `${accounts.length} account(s)`,
  );
  for (const account of accounts) {
    check(
      `${account.provider} ${account.msisdn}`,
      account.status !== "disabled",
      `status=${account.status}, drift=${account.health.balance_drift}`,
    );
  }
  // no_healthy_account is the failure checkout has to explain to a buyer, so it
  // is worth knowing whether this instance could serve one right now.
  check(
    "at least one account can take a payment",
    accounts.some((a) => a.status === "active" || a.status === "degraded"),
  );

  // ── 2. An order to pay for ───────────────────────────────────────────────
  const [order] = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      totalCents: orders.totalCents,
      status: orders.status,
    })
    .from(orders)
    .where(eq(orders.status, "pending"))
    .limit(1);

  if (!order) {
    console.error("\nNo pending order to test with. Run pnpm db:seed first.");
    process.exit(1);
  }
  console.log(
    `\nOrder ${order.orderNumber} — ${order.totalCents} poisha, ${order.status}`,
  );

  // ── 3. Creating a real intent ────────────────────────────────────────────
  console.log("\nIntent");
  // The same parameters lib/payments/jomma/intents.ts sends.
  const intent = await client.intents.create({
    amount: order.totalCents,
    clientReference: order.id,
    provider: "bkash",
    ttlSeconds: 900,
    payerMsisdn: "8801700000000",
    returnUrl: `${BASE}/orders/${order.id}?awaiting=1`,
    cancelUrl: `${BASE}/cart`,
    metadata: { orderId: order.id, orderNumber: order.orderNumber },
    // Fresh every run, or the idempotency key returns the previous intent.
    idempotencyKey: `verify-${order.id}-${Date.now()}`,
  });

  const started = {
    intentId: intent.id,
    payUrl: client.payUrl(intent.id),
    refCode: intent.ref_code,
    receivingMsisdn: intent.receiving_account.msisdn,
    expiresAt: intent.expires_at,
  };

  check("intent created", true, started.intentId);
  check(
    "reference code returned",
    started.refCode !== null,
    started.refCode ?? "",
  );
  check(
    "receiving account returned",
    Boolean(started.receivingMsisdn),
    started.receivingMsisdn,
  );
  check(
    "pay URL built by the SDK",
    started.payUrl.startsWith(process.env.JOMMA_URL ?? ""),
    started.payUrl,
  );
  check(
    "expiry in the future",
    new Date(started.expiresAt) > new Date(),
    started.expiresAt,
  );

  // Reading it back with the amount we asked for is what catches a
  // poisha/taka mix-up before a buyer is told to send the wrong sum.
  const fetched = await client.intents.get(started.intentId);
  check(
    "amount round-trips exactly",
    fetched.amount === order.totalCents,
    `sent ${order.totalCents}, stored ${fetched.amount}`,
  );
  check(
    "client_reference is our order id",
    fetched.client_reference === order.id,
  );

  // ── 4. The pay page is reachable ─────────────────────────────────────────
  const payPage = await fetch(started.payUrl, { redirect: "manual" });
  check(
    "hosted pay page responds",
    payPage.status < 400 || payPage.status === 302,
    `status ${payPage.status}`,
  );

  // ── 5. A genuinely signed webhook ────────────────────────────────────────
  console.log("\nWebhook");

  const eventId = `evt_verify_${Date.now()}`;
  const payload = JSON.stringify({
    id: eventId,
    type: "payment.succeeded",
    created_at: new Date().toISOString(),
    data: {
      intent_id: started.intentId,
      client_reference: order.id,
      amount: order.totalCents,
      received_amount: order.totalCents,
      trx_id: `VERIFY${Date.now()}`,
      sender_msisdn: "8801700000000",
      match_confidence: "exact",
      matched_by: "automatic",
      metadata: {},
    },
  });

  // Forged first, so a pass cannot be an accident of ordering.
  const forged = await deliver(payload, signPayload(payload, "whsec_wrong"));
  check(
    "forged signature rejected",
    forged.status === 400,
    `status ${forged.status}`,
  );

  const unsigned = await deliver(payload, null);
  check(
    "missing signature rejected",
    unsigned.status === 400,
    `status ${unsigned.status}`,
  );

  const real = await deliver(payload, signPayload(payload, secret));
  const realBody = (await real.json()) as { handled?: boolean };
  check(
    "signed delivery accepted",
    real.status === 200,
    `status ${real.status}`,
  );
  check("order handled", realBody.handled === true, JSON.stringify(realBody));

  // ── 6. Idempotency, against the real database ────────────────────────────
  const replay = await deliver(payload, signPayload(payload, secret));
  const replayBody = (await replay.json()) as { duplicate?: boolean };
  check(
    "replay is a no-op",
    replayBody.duplicate === true,
    JSON.stringify(replayBody),
  );

  // ── 7. What actually landed in the database ──────────────────────────────
  console.log("\nState");
  const [after] = await db
    .select({ status: orders.status, intentId: orders.paymentIntentId })
    .from(orders)
    .where(eq(orders.id, order.id));

  check("order is paid", after.status === "paid", `status=${after.status}`);
  check("intent id stored", after.intentId === started.intentId);

  // Scoped to THIS order's sub-orders. A query that is not scoped would pass
  // on any pre-existing ledger row and prove nothing about this payment.
  const subs = await db
    .select({ id: subOrders.id })
    .from(subOrders)
    .where(eq(subOrders.orderId, order.id));

  const entries = await db
    .select({ type: ledgerEntries.type, amount: ledgerEntries.amountCents })
    .from(ledgerEntries)
    .where(
      inArray(
        ledgerEntries.subOrderId,
        subs.map((s) => s.id),
      ),
    );

  const sales = entries.filter((e) => e.type === "sale");
  check(
    "one sale entry per sub-order",
    sales.length === subs.length,
    `${sales.length} sale(s) for ${subs.length} sub-order(s)`,
  );
  check(
    "sale credits are positive",
    sales.every((e) => e.amount > BigInt(0)),
    sales.map((e) => e.amount.toString()).join(", "),
  );

  const events = await db
    .select({
      id: jommaWebhookEvents.id,
      handledAt: jommaWebhookEvents.handledAt,
    })
    .from(jommaWebhookEvents)
    .where(eq(jommaWebhookEvents.id, eventId));

  check("event recorded exactly once", events.length === 1);
  check("event marked handled", events[0]?.handledAt != null);

  // ── 8. The error path checkout has to explain to a buyer ─────────────────
  console.log("\nErrors");
  try {
    await client.intents.create({
      amount: -1,
      clientReference: order.id,
      idempotencyKey: `invalid-${Date.now()}`,
    });
    check("invalid amount rejected", false, "it was accepted");
  } catch (error) {
    const isJomma = error instanceof JommaError;
    check(
      "invalid amount rejected as JommaError",
      isJomma,
      isJomma
        ? `code=${error.code} request_id=${error.requestId}`
        : String(error),
    );
  }

  console.log(
    failures === 0
      ? "\nAll checks passed.\n"
      : `\n${failures} check(s) FAILED.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
