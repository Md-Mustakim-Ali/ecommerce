import { Jomma } from "@jomma/sdk";
import { env } from "@/lib/env";

/**
 * The shared Jomma client.
 *
 * Server-only, and enforced rather than merely intended. JOMMA_API_KEY
 * authorises creating payment requests against a real receiving account, so a
 * client component importing this file must fail the build rather than ship
 * the key to a browser.
 *
 * The enforcement comes from `@/lib/env`, which this imports: Next only
 * inlines NEXT_PUBLIC_* into the browser bundle, so the Zod parse in that
 * module fails at build time the moment it is pulled into a client component.
 * That is the same guard every other secret in this codebase relies on, which
 * is why there is no `server-only` import here — it would be a second, weaker
 * statement of a rule already enforced one import away.
 *
 * ── baseUrl ──────────────────────────────────────────────────────────────
 *
 * Passed explicitly and asserted. The SDK treats it as optional and falls back
 * to a default host, and the documented failure mode is the worst kind: every
 * call fails looking like a network problem rather than a misconfiguration, so
 * the time goes into checking firewalls instead of checking one environment
 * variable.
 */

function required(
  name: "JOMMA_URL" | "JOMMA_API_KEY" | "JOMMA_WEBHOOK_SECRET",
) {
  const value = env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. bKash and Nagad checkout cannot run without it.\n` +
        `Set JOMMA_URL, JOMMA_API_KEY and JOMMA_WEBHOOK_SECRET in .env.local — ` +
        `see docs/jomma.md.`,
    );
  }
  return value;
}

/**
 * True when Jomma is configured.
 *
 * Checkout calls this to decide whether to offer bKash at all. Without it the
 * app would either have to hard-require the variables — stopping anyone
 * without a Jomma instance from booting at all, including CI — or discover the
 * problem at the moment a buyer tries to pay, which is the worst possible time.
 */
export function jommaConfigured(): boolean {
  return Boolean(
    env.JOMMA_URL && env.JOMMA_API_KEY && env.JOMMA_WEBHOOK_SECRET,
  );
}

let cached: Jomma | null = null;

/**
 * Throws unless all three variables are present, so a process that can take a
 * payment cannot be running with half a configuration.
 */
export function jomma(): Jomma {
  if (cached) return cached;

  cached = new Jomma({
    apiKey: required("JOMMA_API_KEY"),
    // Never omitted. See the note above.
    baseUrl: required("JOMMA_URL"),
  });
  return cached;
}

/** The signing secret for inbound webhooks. Never the API key. */
export function jommaWebhookSecret(): string {
  return required("JOMMA_WEBHOOK_SECRET");
}
