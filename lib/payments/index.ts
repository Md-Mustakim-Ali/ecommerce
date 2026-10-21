import { env } from "@/lib/env";
import { ManualPaymentProvider } from "./manual";
import type { PaymentProvider } from "./provider";

/**
 * The single place a concrete provider is chosen.
 *
 * Everything else in the app depends on the PaymentProvider interface, so
 * adding Stripe Connect is a new adapter plus a branch here — not a change to
 * checkout, orders, the ledger or payouts.
 */
let cached: PaymentProvider | null = null;

export function paymentProvider(): PaymentProvider {
  if (cached) return cached;

  // The webhook secret doubles as the manual adapter's signing key. A real
  // provider brings its own.
  cached = new ManualPaymentProvider(env.BETTER_AUTH_SECRET);
  return cached;
}

export type { PaymentProvider } from "./provider";
