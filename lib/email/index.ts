// Relative, not "@/lib/env": lib/auth/index.ts imports this file, and the
// `auth` CLI loads that through jiti, which does not resolve tsconfig path
// aliases. Keep these relative or `pnpm auth:generate` breaks.
import { env } from "../env";
import { log } from "../observability/logger";
import { ConsoleEmailProvider } from "./console";
import type { EmailMessage, EmailProvider, SendResult } from "./provider";
import { looksLikeEmail } from "./provider";
import { ResendEmailProvider } from "./resend";

/**
 * The single place a concrete email provider is chosen.
 *
 * Resend when a key is present, the console otherwise. The console adapter
 * refuses to run in production, so a deployment that forgets the key gets a
 * loud failure rather than order confirmations quietly going nowhere.
 */
let cached: EmailProvider | null = null;

export function emailProvider(): EmailProvider {
  if (cached) return cached;

  if (env.RESEND_API_KEY && env.EMAIL_FROM) {
    cached = new ResendEmailProvider(env.RESEND_API_KEY, env.EMAIL_FROM);
  } else {
    cached = new ConsoleEmailProvider();
  }
  return cached;
}

/** True when mail actually leaves the building. The UI says so where it matters. */
export function emailIsConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}

/**
 * Sends one message.
 *
 * Never throws, and never rethrows. Every caller is doing something more
 * important than sending mail — placing an order, shipping it, paying someone
 * out — and none of those should fail because a mail provider had a bad
 * minute. Failures are logged and returned.
 */
export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  if (!looksLikeEmail(message.to)) {
    return { ok: false, error: `Not a sendable address: ${message.to}` };
  }

  const result = await emailProvider().send(message);

  if (!result.ok) {
    // The subject and recipient, never the body: a receipt contains an address
    // and an order history, and logs are the least protected place either
    // could end up.
    log.error("email send failed", {
      to: message.to,
      subject: message.subject,
      provider: emailProvider().name,
      reason: result.error,
    });
  }

  return result;
}

export type { EmailMessage, EmailProvider, SendResult };
export { looksLikeEmail };
