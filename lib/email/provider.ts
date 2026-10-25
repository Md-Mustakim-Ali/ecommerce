/**
 * The transactional email port.
 *
 * Same shape as lib/storage: one interface, one place that picks an adapter,
 * and nothing that sends mail knows which one it got. Swapping the console
 * adapter for Resend or SES is a new file and a branch in index.ts.
 *
 * Every message is addressed to one recipient. There is no bulk send here on
 * purpose — this is transactional mail, and the moment one function can send
 * to a list it becomes the path of least resistance for marketing, which has
 * different consent rules and different deliverability consequences.
 */

export type EmailMessage = {
  to: string;
  subject: string;
  /** Always both. A text-only client is not an edge case. */
  html: string;
  text: string;
  /** Threads replies onto something the recipient can actually answer. */
  replyTo?: string;
};

export type SendResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<SendResult>;
}

/** Enough to reject the obviously malformed before it reaches a provider. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
