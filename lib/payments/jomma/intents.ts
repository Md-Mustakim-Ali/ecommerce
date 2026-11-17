import type { Intent, ProviderPreference } from "@jomma/sdk";
import { JommaError } from "@jomma/sdk";
import { assertMinorUnits } from "@/lib/money/currency";
import { jomma } from "./client";

/**
 * Creating the payment request for an order.
 *
 * Jomma does not move money. It watches a bKash/Nagad number for incoming Send
 * Money messages and tells us when one matches. So "creating an intent" here
 * means reserving a reference code and a receiving account for this order —
 * nothing is charged, and nothing about this call implies the buyer has paid.
 */

/** What checkout needs back. Deliberately not the raw SDK type. */
export type StartedPayment =
  | {
      ok: true;
      intentId: string;
      /** Where to send the buyer. Built by the SDK, not by us. */
      payUrl: string;
      /** Shown on the waiting page while the webhook is outstanding. */
      refCode: string | null;
      receivingMsisdn: string;
      expiresAt: string;
    }
  | { ok: false; code: JommaFailure; message: string };

/**
 * The failures checkout can do something about.
 *
 * `unavailable` is the one that matters. `no_healthy_account` means no phone
 * is currently watching a receiving number, so there is physically nobody to
 * send money to — the buyer needs a different payment method, not a retry and
 * certainly not a stack trace.
 */
export type JommaFailure = "unavailable" | "invalid" | "error";

/**
 * Fifteen minutes.
 *
 * Long enough for a buyer to open their bKash app, find the number and type an
 * amount; short enough that abandoned checkouts release the receiving account
 * and their reserved stock the same afternoon. The SDK caps this at 3600.
 */
export const INTENT_TTL_SECONDS = 900;

export async function startPayment(input: {
  orderId: string;
  orderNumber: string;
  /** Integer minor units. With BDT as the platform currency this is poisha. */
  amountMinorUnits: number;
  provider: ProviderPreference;
  /**
   * A *suggested* number for the buyer to pay from, in canonical
   * `01XXXXXXXXX` form. Null when there is nothing sensible to suggest.
   *
   * Since Jomma 1.4.19 this is a suggestion rather than an assertion: the pay
   * page shows it masked, asks the buyer to confirm, and lets them replace it.
   * Before that it was taken as settled fact and the question was skipped,
   * which is why a delivery number sent here used to break auto-matching for
   * anyone paying from a different handset.
   *
   * Worth sending now: the matcher scores a known payer number at 60 points,
   * so a confirmed one is often the difference between an order settling by
   * itself and one waiting in manual review.
   *
   * Canonicalise before passing it. Jomma validates a bare 01XXXXXXXXX, so
   * "017 1234 5678" or "+8801712345678" — both things buyers actually type —
   * would be rejected for a number that is perfectly correct.
   */
  payerMsisdn: string | null;
  returnUrl: string;
  cancelUrl: string;
  /**
   * What distinguishes this request for payment from the last one.
   *
   * Feeds the idempotency key, so retrying the *same* request produces the same
   * intent while a genuinely new one produces a new intent. A number for the
   * first attempt; the resume path passes `after-<replaced intent id>`, which
   * is stable for that repair and different for the next — so a double-click
   * cannot leave the buyer holding two live reference codes for one order.
   */
  attempt: number | string;
}): Promise<StartedPayment> {
  // Rule one: no float ever reaches this path. Every amount in this codebase
  // comes from an integer column, so this should be unreachable — which is
  // precisely why it is worth asserting before it leaves the building.
  const amount = assertMinorUnits(input.amountMinorUnits, "intent amount");

  const client = jomma();

  let intent: Intent;
  try {
    intent = await client.intents.create({
      amount,
      clientReference: input.orderId,
      provider: input.provider,
      ttlSeconds: INTENT_TTL_SECONDS,
      payerMsisdn: input.payerMsisdn,
      returnUrl: input.returnUrl,
      cancelUrl: input.cancelUrl,
      metadata: { orderId: input.orderId, orderNumber: input.orderNumber },
      // Our own key, not a generated one. The SDK is explicit that omitting it
      // makes a retried request allocate a *second* reference code, leaving
      // the buyer holding two live codes for one order where only one of them
      // settles it.
      idempotencyKey: `order-${input.orderId}-attempt-${input.attempt}`,
    });
  } catch (error) {
    return toFailure(error);
  }

  return {
    ok: true,
    intentId: intent.id,
    // Built by the SDK so it cannot be aimed at the wrong host — a hand-made
    // URL fails as a 404 on a page the buyer was just told to trust.
    payUrl: client.payUrl(intent.id),
    refCode: intent.ref_code,
    receivingMsisdn: intent.receiving_account.msisdn,
    expiresAt: intent.expires_at,
  };
}

/** Releases the reference code and the receiving-account lock. */
export async function cancelPayment(intentId: string): Promise<void> {
  try {
    await jomma().intents.cancel(intentId);
  } catch (error) {
    // Cancelling is best-effort cleanup. The intent expires on its own TTL
    // anyway, so failing here must never block the thing that asked for it.
    if (error instanceof JommaError && error.code === "not_found") return;
    throw error;
  }
}

function toFailure(error: unknown): StartedPayment {
  if (error instanceof JommaError) {
    switch (error.code) {
      case "no_healthy_account":
      case "no_capacity":
        return {
          ok: false,
          code: "unavailable",
          message:
            "bKash and Nagad are unavailable right now. Please choose another payment method.",
        };
      case "lock_taken":
        return {
          ok: false,
          code: "unavailable",
          message:
            "That payment is already in progress. Please wait a moment and try again.",
        };
      case "validation_failed":
        return {
          ok: false,
          code: "invalid",
          message:
            "We could not start that payment. Please check your details.",
        };
      default:
        // The request id is the whole point of keeping this. It turns a
        // support conversation from "a payment failed yesterday" into one log
        // line on the Jomma side.
        console.error("[jomma] intent creation failed", {
          code: error.code,
          status: error.status,
          requestId: error.requestId,
        });
        return {
          ok: false,
          code: "error",
          message: "We could not start that payment. Please try again.",
        };
    }
  }

  console.error("[jomma] intent creation threw", error);
  return {
    ok: false,
    code: "error",
    message: "We could not start that payment. Please try again.",
  };
}
