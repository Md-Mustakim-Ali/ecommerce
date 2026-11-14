import { randomUUID } from "node:crypto";
import type { SendResult, SmsMessage, SmsProvider } from "./provider";

/**
 * Writes messages to the server log instead of sending them.
 *
 * The default, and the reason the rest of the application can call sendSms
 * unconditionally. It also makes phone verification testable before any
 * gateway exists: sign up with a number, read the OTP off the terminal, and
 * the whole claim-your-orders path runs end to end.
 *
 * Refuses to run in production, like the console email adapter. A silent no-op
 * there means buyers who can never verify a number and never see the orders
 * they placed as a guest, with nothing in the logs saying why.
 */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = "console";

  async send(message: SmsMessage): Promise<SendResult> {
    if (process.env.NODE_ENV === "production") {
      return {
        ok: false,
        error:
          "No SMS provider configured. Implement an SmsProvider and select it in lib/sms/index.ts.",
      };
    }

    const id = randomUUID();
    console.info(
      [
        "",
        "──────────── sms (not sent) ────────────",
        `to: ${message.to}`,
        "",
        message.body,
        "────────────────────────────────────────",
        "",
      ].join("\n"),
    );

    return { ok: true, id };
  }
}
