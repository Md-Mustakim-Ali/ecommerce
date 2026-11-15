// Relative, not "@/lib/env": lib/auth/index.ts imports this file, and the
// `auth` CLI loads that through jiti, which does not resolve tsconfig path
// aliases. Keep these relative or `pnpm auth:generate` breaks.
import { env } from "../env";
import { log } from "../observability/logger";
import { ConsoleEmailProvider } from "./console";
import { GmailEmailProvider } from "./gmail";
import type { EmailMessage, EmailProvider, SendResult } from "./provider";
import { looksLikeEmail } from "./provider";
import { ResendEmailProvider } from "./resend";

/**
 * The single place a concrete email provider is chosen.
 *
 * Gmail first, then Resend, then the console. The console adapter refuses to
 * run in production, so a deployment that forgets both gets a loud failure
 * rather than order confirmations quietly going nowhere.
 *
 * Gmail leads because of the situation this shop deploys into rather than any
 * general superiority. Resend only sends from a domain whose DNS you have
 * verified, and a Render subdomain is not one you own; Gmail sends as the
 * account that consented, so it needs no domain. Render also blocks outbound
 * SMTP, which is why both of these are HTTP APIs and no SMTP adapter exists.
 *
 * The day a real domain is verified, set the Resend pair and drop the Gmail
 * three: Resend has bounce handling, higher limits, and does not tie the
 * shop's mail to one person's Google account.
 */
let cached: EmailProvider | null = null;

export function emailProvider(): EmailProvider {
  if (cached) return cached;

  if (gmailIsConfigured()) {
    cached = new GmailEmailProvider({
      clientId: env.GMAIL_CLIENT_ID as string,
      clientSecret: env.GMAIL_CLIENT_SECRET as string,
      refreshToken: env.GMAIL_REFRESH_TOKEN as string,
      from: env.EMAIL_FROM as string,
    });
  } else if (env.RESEND_API_KEY && env.EMAIL_FROM) {
    cached = new ResendEmailProvider(env.RESEND_API_KEY, env.EMAIL_FROM);
  } else {
    cached = new ConsoleEmailProvider();
  }
  return cached;
}

function gmailIsConfigured(): boolean {
  return Boolean(
    env.GMAIL_CLIENT_ID &&
      env.GMAIL_CLIENT_SECRET &&
      env.GMAIL_REFRESH_TOKEN &&
      env.EMAIL_FROM,
  );
}

/**
 * True when mail actually leaves the building.
 *
 * Read in two places that matter beyond the UI: it gates
 * `requireEmailVerification`, and verification is what attaches a guest's past
 * orders to their account. Turning email on therefore turns claiming on.
 */
export function emailIsConfigured(): boolean {
  return gmailIsConfigured() || Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
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
