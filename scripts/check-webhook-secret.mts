/**
 * Answers one question: is JOMMA_WEBHOOK_SECRET the same value Jomma signs with?
 *
 * That question is surprisingly hard to answer any other way. Posting an
 * unsigned request proves only that *a* secret is configured — a wrong secret
 * and a right secret both reject it with the same 400, so the check that looks
 * like it passed tells you nothing. And Jomma has no "send test event" button:
 * a delivery only exists after a real payment, so waiting for one means
 * discovering the mismatch from a customer who paid and never got their order.
 *
 * So this signs a payload with the secret you have and sends it to the
 * deployed webhook. The response separates the two cases cleanly:
 *
 *   400  the signature did not verify — wrong secret
 *   200  it verified
 *
 * The event names an intent that does not exist, so the handler records it and
 * stops at "no matching order". Nothing is marked paid, no ledger entry is
 * written, no email goes out. The only trace is one row in
 * jomma_webhook_events, which is exactly the evidence we want.
 *
 * The secret never leaves your machine.
 *
 *   JOMMA_WEBHOOK_SECRET="whsec_..." \
 *   TARGET="https://ecommerce-web-jy5n.onrender.com" \
 *   pnpm tsx scripts/check-webhook-secret.mts
 */
import { signPayload } from "@jomma/sdk";

const secret = process.env.JOMMA_WEBHOOK_SECRET;
const target = process.env.TARGET ?? "http://localhost:3300";

if (!secret) {
  console.error(
    'JOMMA_WEBHOOK_SECRET is not set.\n\nJOMMA_WEBHOOK_SECRET="whsec_..." TARGET="https://..." pnpm tsx scripts/check-webhook-secret.mts',
  );
  process.exit(1);
}
if (!secret.startsWith("whsec_")) {
  console.warn(
    `Warning: the secret does not start with "whsec_". Jomma generates endpoint\n` +
      `secrets in that form. WEBHOOK_SIGNING_SECRET — the environment variable\n` +
      `that verifies webhooks arriving INTO Jomma — is a different value and\n` +
      `will not work here.\n`,
  );
}

const url = `${target.replace(/\/+$/, "")}/api/webhooks/jomma`;
const payload = JSON.stringify({
  id: `evt_secretcheck_${Date.now()}`,
  type: "payment.succeeded",
  created_at: new Date().toISOString(),
  data: {
    // Deliberately not a real intent, so the handler cannot act on it.
    intent_id: "int_secret_check_not_a_real_intent",
    client_reference: "00000000-0000-4000-8000-000000000000",
    amount: 1,
    received_amount: 1,
    trx_id: "SECRETCHECK",
    sender_msisdn: null,
    match_confidence: null,
    matched_by: null,
    metadata: {},
  },
});

console.log(`POST ${url}`);
const response = await fetch(url, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-jomma-signature": signPayload(payload, secret),
  },
  body: payload,
});

const body = await response.text();
console.log(`status ${response.status}  ${body.slice(0, 160)}\n`);

if (response.status === 400) {
  console.error(
    "✗ WRONG SECRET.\n\n" +
      "  The signature did not verify. Copy the whsec_... shown when you created\n" +
      "  the webhook endpoint in Jomma (Apps -> Webhook endpoints), not the\n" +
      "  WEBHOOK_SIGNING_SECRET environment variable.",
  );
  process.exitCode = 1;
} else if (response.status === 200) {
  console.log(
    "✓ CORRECT SECRET.\n\n" +
      "  The signature verified and the event was accepted. It reports no\n" +
      "  matching order because the intent is fake — that is the expected\n" +
      "  result and means a real payment would be handled.",
  );
  process.exitCode = 0;
} else {
  console.error(
    `? Unexpected status ${response.status}.\n\n` +
      "  500 with 'webhook not configured' means JOMMA_WEBHOOK_SECRET is not\n" +
      "  set on the server at all.",
  );
  process.exitCode = 1;
}
