import { randomUUID } from "node:crypto";
import type { EmailMessage, EmailProvider, SendResult } from "./provider";

/**
 * Writes mail to the server log instead of sending it.
 *
 * The default, and the reason the rest of the application can call sendEmail
 * unconditionally. Without it every caller would need a "if email is
 * configured" branch, and those branches rot — the first real provider would
 * find half of them missing.
 *
 * Refuses to run in production. A silent no-op there means order confirmations
 * that nobody receives and nobody notices, which is worse than a startup
 * failure that says exactly what is missing.
 */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";

  async send(message: EmailMessage): Promise<SendResult> {
    if (process.env.NODE_ENV === "production") {
      return {
        ok: false,
        error:
          "No email provider configured. Set RESEND_API_KEY, or implement another EmailProvider in lib/email/index.ts.",
      };
    }

    const id = randomUUID();
    // The text body, not the HTML: this is for a developer reading a terminal,
    // and a wall of markup would bury the link they need to click.
    console.info(
      [
        "",
        "──────────── email (not sent) ────────────",
        `to:      ${message.to}`,
        `subject: ${message.subject}`,
        message.replyTo ? `reply-to: ${message.replyTo}` : null,
        "",
        message.text,
        "──────────────────────────────────────────",
        "",
      ]
        .filter((line) => line !== null)
        .join("\n"),
    );

    return { ok: true, id };
  }
}
