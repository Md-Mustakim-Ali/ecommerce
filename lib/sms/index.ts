// Relative, not "@/lib/...": lib/auth/index.ts imports this file, and the
// `auth` CLI loads that through jiti, which does not resolve tsconfig path
// aliases. Keep these relative or `pnpm auth:generate` breaks.
import { log } from "../observability/logger";
import { normaliseBdMobile } from "../validation/phone";
import { ConsoleSmsProvider } from "./console";
import type { SendResult, SmsMessage, SmsProvider } from "./provider";

/**
 * The single place a concrete SMS provider is chosen.
 *
 * Only the console adapter exists so far. When a gateway is picked, it becomes
 * a new file and a branch here — the same shape lib/email took for Resend, so
 * nothing that sends a message has to change.
 */
let cached: SmsProvider | null = null;

export function smsProvider(): SmsProvider {
  cached ??= new ConsoleSmsProvider();
  return cached;
}

/**
 * True when a message actually leaves the building.
 *
 * Read by the sign-up form, which must not offer phone-only registration it
 * cannot complete: an account whose only identifier can never be verified is
 * an account that can never claim its orders and can never recover itself.
 */
export function smsIsConfigured(): boolean {
  return smsProvider().name !== "console";
}

/**
 * Whether to offer the phone path in the auth screens at all.
 *
 * True in development even without a gateway, because the console adapter
 * prints the code to the terminal and the whole flow — register, verify, claim
 * — is then testable. False in production without one, where the same adapter
 * refuses to send: offering a code that will never arrive strands the buyer on
 * a screen with no way forward and no error to explain it.
 */
export function phoneAuthAvailable(): boolean {
  return smsIsConfigured() || process.env.NODE_ENV !== "production";
}

/**
 * Sends one message.
 *
 * Never throws, for the same reason sendEmail does not: every caller is doing
 * something more important than sending an SMS, and none of those should fail
 * because a gateway had a bad minute. Failures are logged and returned.
 */
export async function sendSms(message: SmsMessage): Promise<SendResult> {
  const to = normaliseBdMobile(message.to);
  if (!to) {
    return { ok: false, error: "Not a sendable number" };
  }

  const result = await smsProvider().send({ ...message, to });

  if (!result.ok) {
    // The recipient and the reason, never the body. An OTP is a credential for
    // the few minutes it lives, and logs are the least protected place it
    // could end up.
    log.error("sms send failed", {
      to,
      provider: smsProvider().name,
      reason: result.error,
    });
  }

  return result;
}

export type { SmsMessage, SmsProvider, SendResult };
