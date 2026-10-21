/**
 * The payment provider port.
 *
 * AGENTS.md lists the target market and the payment provider as open
 * decisions, and says the split-payment flow looks materially different
 * depending on which. Rather than block everything downstream on that call,
 * the order, ledger and payout machinery is written against this interface and
 * a provider is an adapter behind it.
 *
 * Choosing Stripe Connect later means writing one file, not rewriting
 * checkout. Choosing a market where cash on delivery or bank transfer is the
 * norm means the manual adapter is already the answer.
 *
 * Deliberately narrow. Everything a provider needs to do is here, and nothing
 * a provider happens to offer leaks past it — the moment order creation starts
 * reaching for a Stripe type, the port has failed.
 */

export type PaymentStatus =
  | "requires_action"
  | "processing"
  | "succeeded"
  | "failed"
  | "cancelled";

export type PaymentIntent = {
  /** Provider-side id, stored on orders.payment_intent_id. */
  id: string;
  status: PaymentStatus;
  amountCents: number;
  currency: string;
  /**
   * Passed to a client SDK where one exists. Never logged, never persisted —
   * it authorises the payment.
   */
  clientSecret?: string;
  /** Where to send the buyer, for redirect-based providers. */
  redirectUrl?: string;
};

export type CreateIntentInput = {
  orderId: string;
  amountCents: number;
  currency: string;
  /** For receipts and fraud checks. Never card data. */
  buyerEmail: string;
  /** Provider-side idempotency, so a retried request cannot charge twice. */
  idempotencyKey: string;
  metadata?: Record<string, string>;
};

export type RefundResult = {
  id: string;
  amountCents: number;
  status: "pending" | "succeeded" | "failed";
};

export type WebhookEvent =
  | { type: "payment.succeeded"; intentId: string; amountCents: number }
  | { type: "payment.failed"; intentId: string; reason?: string }
  | { type: "refund.succeeded"; intentId: string; amountCents: number }
  | { type: "ignored"; reason: string };

export interface PaymentProvider {
  readonly name: string;

  /**
   * True when the provider settles outside the app — cash on delivery, bank
   * transfer. Checkout skips the payment step and the order waits for an
   * admin to confirm receipt.
   */
  readonly settlesOffline: boolean;

  createIntent(input: CreateIntentInput): Promise<PaymentIntent>;

  /** Current provider-side state. The source of truth, not our own record. */
  getIntent(intentId: string): Promise<PaymentIntent | null>;

  refund(input: {
    intentId: string;
    amountCents: number;
    idempotencyKey: string;
    reason?: string;
  }): Promise<RefundResult>;

  /**
   * Verifies the signature and parses the payload.
   *
   * Must verify before doing anything else. An unverified webhook is an
   * unauthenticated request that moves money.
   */
  parseWebhook(input: {
    payload: string;
    signature: string | null;
  }): Promise<WebhookEvent>;
}
