import type { EmailMessage, EmailProvider, SendResult } from "./provider";

/**
 * Gmail, over its HTTP API.
 *
 * Chosen over SMTP deliberately: this runs on Render, which blocks outbound
 * SMTP, so a mail path that depends on port 465 or 587 does not work there at
 * all. The Gmail REST API is plain HTTPS on 443 and is unaffected.
 *
 * Chosen over Resend for the situation this shop is actually in — Resend will
 * only send from a domain whose DNS you have verified, and a Render subdomain
 * is not a domain you own. Gmail sends as the account that granted consent, so
 * a plain @gmail.com address works with no DNS at all. Resend stays configured
 * in index.ts and is the better answer the day a real domain exists.
 *
 * No SDK, for the same reason as Resend: this is one POST.
 *
 * Never throws. A failed send must not take down the request that triggered it.
 */

const SEND_ENDPOINT =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

export type GmailCredentials = {
  clientId: string;
  clientSecret: string;
  /**
   * Long-lived, from a one-time consent — see scripts/gmail-authorise.mts.
   *
   * It only stays long-lived if the Cloud project's OAuth consent screen is
   * published. While it is in "Testing", Google expires refresh tokens after
   * seven days, and email silently stops working a week after it was set up.
   */
  refreshToken: string;
  /** The Gmail address that consented. Gmail rewrites From: to match it. */
  from: string;
};

/** RFC 5322 needs CRLF, and Gmail rejects the message outright without it. */
const CRLF = "\r\n";

/**
 * Encodes a header value that may contain non-ASCII.
 *
 * A store called "Kilnhouse — Paper & Press" in a subject line is not
 * hypothetical, and a raw em dash in a header is invalid: headers are ASCII,
 * so anything else has to be RFC 2047 encoded or it arrives as mojibake.
 */
function encodeHeader(value: string): string {
  // Printable ASCII only. Anything outside it has to be encoded.
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/**
 * Builds the raw RFC 5322 message.
 *
 * multipart/alternative with both bodies, because a text-only client is not an
 * edge case and the port already requires both. Base64 for the parts rather
 * than quoted-printable: it cannot produce a line over 76 characters or an
 * unescaped bare dot, which are the two ways a hand-rolled encoder corrupts
 * mail.
 */
export function buildRawMessage(
  message: EmailMessage,
  from: string,
  boundary = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
): string {
  const part = (contentType: string, body: string) =>
    [
      `--${boundary}`,
      `Content-Type: ${contentType}; charset="UTF-8"`,
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(body, "utf8")
        .toString("base64")
        .replace(/(.{76})/g, `$1${CRLF}`),
      "",
    ].join(CRLF);

  const headers = [
    `From: ${from}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  if (message.replyTo) headers.push(`Reply-To: ${message.replyTo}`);

  return [
    headers.join(CRLF),
    "",
    part("text/plain", message.text),
    part("text/html", message.html),
    `--${boundary}--`,
    "",
  ].join(CRLF);
}

/** base64url, which is what the API wants — not standard base64. */
export function toBase64Url(raw: string): string {
  return Buffer.from(raw, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export class GmailEmailProvider implements EmailProvider {
  readonly name = "gmail";

  /**
   * Cached in memory. An access token lasts an hour and every send needs one,
   * so without this each receipt costs two round trips. Best-effort — the
   * cache dies with the instance, which on a free tier that sleeps is often.
   */
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly credentials: GmailCredentials) {}

  private async accessToken(): Promise<string> {
    // A minute of headroom, so a token cannot expire between here and the send.
    if (this.token && this.token.expiresAt - 60_000 > Date.now()) {
      return this.token.value;
    }

    // Deliberately not lib/media/google/oauth.ts. That module throws
    // GoogleApiError for a failover loop that decides which seller's account
    // to try next; this has one account and must never throw. Same endpoint,
    // different contract.
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.credentials.clientId,
        client_secret: this.credentials.clientSecret,
        refresh_token: this.credentials.refreshToken,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const body = (await response.json().catch(() => null)) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    } | null;

    if (!response.ok || !body?.access_token) {
      // invalid_grant means the refresh token is dead, and there are only a
      // few ways that happens. Naming them turns a generic OAuth error into
      // something actionable, because none of them are guessable from the
      // message Google returns.
      const hint =
        body?.error === "invalid_grant"
          ? " The refresh token is dead. Usually the project was still in Testing when it was minted, so Google expired it after seven days" +
            " — publishing later does not rescue a token already issued. It is also revoked when the account's password is reset, or after six months unused." +
            " Re-run scripts/gmail-authorise.mts once the project is published."
          : "";
      throw new Error(
        `Gmail token refresh failed (${response.status}): ${body?.error_description ?? body?.error ?? "no access_token"}.${hint}`,
      );
    }

    this.token = {
      value: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    };
    return this.token.value;
  }

  async send(message: EmailMessage): Promise<SendResult> {
    try {
      const accessToken = await this.accessToken();
      const raw = toBase64Url(buildRawMessage(message, this.credentials.from));

      const response = await fetch(SEND_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ raw }),
        // Without this a hung provider holds a checkout request open until the
        // platform's own timeout kills it.
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        // A dead token should not poison the next attempt.
        if (response.status === 401) this.token = null;
        return {
          ok: false,
          error: `Gmail returned ${response.status}. ${body.slice(0, 200)}`,
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
