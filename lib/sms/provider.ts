/**
 * The transactional SMS port.
 *
 * Same shape as lib/email and lib/storage: one interface, one place that picks
 * an adapter, and nothing that sends a message knows which one it got.
 *
 * This exists because phone is a first-class account identifier. A number that
 * cannot be verified is a number that cannot safely claim an order history, so
 * "send an OTP" has to be a real call from the day the phone column exists —
 * even while the only adapter writes to the terminal.
 *
 * One recipient per message, and no bulk send, for the same reason as email:
 * the moment one function can send to a list it becomes the path of least
 * resistance for marketing, which has different consent rules. In Bangladesh
 * it also has different legal ones.
 */

export type SmsMessage = {
  /** Canonical `01XXXXXXXXX`. Normalise before calling; this does not guess. */
  to: string;
  body: string;
};

export type SendResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<SendResult>;
}
