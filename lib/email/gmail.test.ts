import { describe, expect, it } from "vitest";
import { buildRawMessage, toBase64Url } from "./gmail";

const message = {
  to: "buyer@example.com",
  subject: "Your order ORD-2026-000123",
  html: "<p>Thanks</p>",
  text: "Thanks",
};

/** Decodes a base64 body part back to the string it encoded. */
function decodePart(raw: string, contentType: string): string {
  const section = raw
    .split(/--[^\r\n]+\r\n/)
    .find((s) => s.includes(`Content-Type: ${contentType}`));
  if (!section) throw new Error(`no ${contentType} part`);
  const body = section.split("\r\n\r\n")[1] ?? "";
  return Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8");
}

describe("buildRawMessage", () => {
  it("carries both bodies, decodable", () => {
    const raw = buildRawMessage(message, "shop@gmail.com");
    expect(decodePart(raw, "text/plain")).toBe("Thanks");
    expect(decodePart(raw, "text/html")).toBe("<p>Thanks</p>");
  });

  it("uses CRLF line endings throughout", () => {
    const raw = buildRawMessage(message, "shop@gmail.com");
    // A bare LF anywhere makes Gmail reject the message.
    expect(/[^\r]\n/.test(raw)).toBe(false);
  });

  it("sets the headers Gmail needs", () => {
    const raw = buildRawMessage(message, "shop@gmail.com", "BOUND");
    expect(raw).toContain("From: shop@gmail.com");
    expect(raw).toContain("To: buyer@example.com");
    expect(raw).toContain("MIME-Version: 1.0");
    expect(raw).toContain(
      'Content-Type: multipart/alternative; boundary="BOUND"',
    );
    expect(raw.trimEnd().endsWith("--BOUND--")).toBe(true);
  });

  it("omits Reply-To when there is none, and includes it when there is", () => {
    expect(buildRawMessage(message, "shop@gmail.com")).not.toContain(
      "Reply-To:",
    );
    expect(
      buildRawMessage(
        { ...message, replyTo: "hello@example.com" },
        "shop@gmail.com",
      ),
    ).toContain("Reply-To: hello@example.com");
  });

  /**
   * The case that produces mojibake rather than an error. Headers are ASCII;
   * a store called "Kilnhouse — Paper & Press" is not hypothetical.
   */
  it("RFC 2047 encodes a non-ASCII subject", () => {
    const raw = buildRawMessage(
      { ...message, subject: "Kilnhouse — অর্ডার" },
      "shop@gmail.com",
    );
    const line = raw.split("\r\n").find((l) => l.startsWith("Subject: "));
    expect(line).toMatch(/^Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);

    const encoded = line?.slice("Subject: =?UTF-8?B?".length, -3) ?? "";
    expect(Buffer.from(encoded, "base64").toString("utf8")).toBe(
      "Kilnhouse — অর্ডার",
    );
  });

  it("leaves a plain ASCII subject alone", () => {
    const raw = buildRawMessage(message, "shop@gmail.com");
    expect(raw).toContain("Subject: Your order ORD-2026-000123");
  });

  it("survives a body long enough to need wrapping", () => {
    const long = "শুভেচ্ছা ".repeat(500);
    const raw = buildRawMessage({ ...message, text: long }, "shop@gmail.com");
    // No encoded line may exceed the 76-character limit.
    const overlong = raw
      .split("\r\n")
      .filter((l) => !l.startsWith("--") && !l.includes(": "))
      .some((l) => l.length > 76);
    expect(overlong).toBe(false);
    expect(decodePart(raw, "text/plain")).toBe(long);
  });
});

describe("toBase64Url", () => {
  it("produces url-safe base64 with no padding", () => {
    // Chosen to force both + and / in standard base64.
    const encoded = toBase64Url("??>?øÿ");
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it("round-trips", () => {
    const raw = buildRawMessage(message, "shop@gmail.com");
    const back = Buffer.from(
      toBase64Url(raw).replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    expect(back).toBe(raw);
  });
});
