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
   * The number the buyer will send money FROM. Not their delivery number.
   *
   * Null is the right value whenever the caller is not certain, and certainty
   * is rarer than it looks: the phone taken at checkout belongs to whoever
   * receives the parcel, which is often not whoever pays for it.
   *
   * Passing a value here is not a hint. Jomma reads a populated payerMsisdn as
   * settled fact — `payerKnown` on the pay page is a plain Boolean over this
   * field — and skips asking the buyer. So a guess sent here is silently
   * adopted as the answer, and payments from any other handset fail to
   * auto-match with nothing visibly misconfigured anywhere.
   *
   * Null costs one screen on the pay page and gets the number from the only
   * party who actually knows it.
   */
  payerMsisdn: string | null;
  returnUrl: string;
  cancelUrl: string;
  /** Bumped by the caller only when deliberately re-requesting payment. */
  attempt: number;
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
