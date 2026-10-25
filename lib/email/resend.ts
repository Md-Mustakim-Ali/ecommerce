import type { EmailMessage, EmailProvider, SendResult } from "./provider";

/**
 * Resend, over its HTTP API.
 *
 * No SDK. The API is one POST and the SDK is a dependency that has to be kept
 * current, audited, and bundled — for a fetch call with three fields.
 *
 * Never throws. A failed send must not take down the request that triggered
 * it: an order that was placed and paid for is not undone because the receipt
 * bounced, and the caller decides what a failure means.
 */
export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<SendResult> {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          reply_to: message.replyTo,
        }),
        // Without this a hung provider holds a checkout request open until the
        // platform's own timeout kills it.
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        // Read as text: an error body is not reliably JSON, and a parse
        // failure here would replace a useful message with a parse error.
        const body = await response.text().catch(() => "");
        return {
          ok: false,
          error: `Resend returned ${response.status}. ${body.slice(0, 200)}`,
        };
      }

      const data = (await response.json()) as { id?: string };
      return { ok: true, id: data.id ?? "unknown" };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Send failed.",
      };
    }
  }
}
