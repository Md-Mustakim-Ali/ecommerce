import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  CreateIntentInput,
  PaymentIntent,
  PaymentProvider,
  RefundResult,
  WebhookEvent,
} from "./provider";

/**
 * Manual settlement.
 *
 * Two jobs. It is the development adapter, so checkout is exercisable end to
 * end without a provider account. And it is a real strategy: in markets where
 * cash on delivery or bank transfer dominates, "the buyer pays outside the
 * app and an admin confirms it" is the actual flow, not a placeholder.
 *
 * It never touches card data, because there is none to touch.
 */
export class ManualPaymentProvider implements PaymentProvider {
  readonly name = "manual";
  readonly settlesOffline = true;

  constructor(private readonly webhookSecret: string) {}

  async createIntent(input: CreateIntentInput): Promise<PaymentIntent> {
    // Derived from the idempotency key rather than random, so a retried
    // request produces the same intent id instead of a second one.
    const id = `manual_${hash(input.idempotencyKey)}`;
    return {
      id,
      // Offline settlement: nothing is captured until someone confirms it.
      status: "processing",
      amountCents: input.amountCents,
      currency: input.currency,
    };
  }

  async getIntent(intentId: string): Promise<PaymentIntent | null> {
    // There is no remote to ask. The order's own status is the record, and
    // callers should not be consulting this adapter for it.
    return intentId.startsWith("manual_")
      ? { id: intentId, status: "processing", amountCents: 0, currency: "" }
      : null;
  }

  async refund(input: {
    intentId: string;
    amountCents: number;
    idempotencyKey: string;
  }): Promise<RefundResult> {
    return {
      id: `manual_refund_${hash(input.idempotencyKey)}`,
      amountCents: input.amountCents,
      status: "succeeded",
    };
  }

  /**
   * Verifies an HMAC over the raw body before parsing anything.
   *
   * Even for a manual provider this matters: the endpoint marks orders paid,
   * so an unauthenticated caller could hand themselves free goods.
   */
  async parseWebhook(input: {
    payload: string;
    signature: string | null;
  }): Promise<WebhookEvent> {
    if (!input.signature)
      return { type: "ignored", reason: "missing signature" };

    const expected = createHmac("sha256", this.webhookSecret)
      .update(input.payload)
      .digest("hex");

    const provided = Buffer.from(input.signature, "utf8");
    const computed = Buffer.from(expected, "utf8");

    // Constant-time, and length-checked first because timingSafeEqual throws
    // on a length mismatch — which would itself leak the expected length.
    if (
      provided.length !== computed.length ||
      !timingSafeEqual(provided, computed)
    ) {
      return { type: "ignored", reason: "bad signature" };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(input.payload);
    } catch {
      return { type: "ignored", reason: "malformed payload" };
    }

    const body = parsed as {
      type?: string;
      intentId?: string;
      amountCents?: number;
    };
    if (typeof body.intentId !== "string") {
      return { type: "ignored", reason: "no intentId" };
    }

    switch (body.type) {
      case "payment.succeeded":
        return {
          type: "payment.succeeded",
          intentId: body.intentId,
          amountCents: Number(body.amountCents ?? 0),
        };
      case "payment.failed":
        return { type: "payment.failed", intentId: body.intentId };
      case "refund.succeeded":
        return {
          type: "refund.succeeded",
          intentId: body.intentId,
          amountCents: Number(body.amountCents ?? 0),
        };
      default:
        return { type: "ignored", reason: `unhandled type ${body.type}` };
    }
  }
}

function hash(value: string): string {
  return createHmac("sha256", "intent")
    .update(value)
    .digest("hex")
    .slice(0, 24);
}
