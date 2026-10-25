import { describe, expect, it } from "vitest";
import { redact } from "./redact";

/**
 * Tests for redaction specifically.
 *
 * The formatting is not worth testing — if a log line comes out ugly, someone
 * notices immediately. A secret that slips through is noticed by nobody, and
 * once it has been shipped to a log aggregator it has to be treated as
 * compromised. So every one of these is a leak that would otherwise be silent.
 */

describe("redact", () => {
  it("removes values under secret-looking keys", () => {
    expect(redact({ email: "a@b.test", password: "hunter2-hunter2" })).toEqual({
      email: "a@b.test",
      password: "[redacted]",
    });
  });

  it("matches the key anywhere in the name, not just exactly", () => {
    const out = redact({
      userPassword: "x",
      "X-Api-Key": "y",
      sessionToken: "z",
      accessKeyId: "w",
    }) as Record<string, unknown>;

    expect(Object.values(out)).toEqual([
      "[redacted]",
      "[redacted]",
      "[redacted]",
      "[redacted]",
    ]);
  });

  it("removes a card number even under an innocent key", () => {
    // The realistic version of this leak: a validation error echoing back the
    // field that failed, under a name like "value".
    expect(redact({ value: "4111111111111111" })).toEqual({
      value: "[redacted]",
    });
  });

  it("removes a JWT found in prose", () => {
    const line =
      "failed with eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc";
    expect(redact(line)).toBe("[redacted]");
  });

  it("removes provider keys by prefix", () => {
    expect(redact("using sk_live_abcdefghijklmnop1234")).toBe("[redacted]");
    expect(redact("whsec_abcdefghijklmnop1234")).toBe("[redacted]");
  });

  it("leaves ordinary values alone", () => {
    expect(
      redact({ orderNumber: "ORD-2026-000123", totalCents: 4499, ok: true }),
    ).toEqual({ orderNumber: "ORD-2026-000123", totalCents: 4499, ok: true });
  });

  it("does not mistake an order total or a year for a card", () => {
    // Four to twelve digits must survive, or every price and timestamp in the
    // logs becomes [redacted] and the logs become useless.
    expect(redact({ n: "4499" })).toEqual({ n: "4499" });
    expect(redact({ n: "1788459880459" })).toEqual({ n: "[redacted]" });
  });

  it("recurses into nested structures", () => {
    expect(
      redact({ request: { headers: { cookie: "session=abc" }, path: "/x" } }),
    ).toEqual({
      request: { headers: { cookie: "[redacted]" }, path: "/x" },
    });
  });

  it("keeps an error's name and message but not its stack in production", () => {
    const error = new Error("boom");
    const out = redact(error) as Record<string, unknown>;
    expect(out.name).toBe("Error");
    expect(out.message).toBe("boom");
  });

  it("redacts a secret hiding inside an error message", () => {
    const out = redact(new Error("card 4111111111111111 declined")) as {
      message: string;
    };
    expect(out.message).toBe("[redacted]");
  });

  it("stops rather than hanging on a cycle", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => redact(a)).not.toThrow();
    expect(JSON.stringify(redact(a))).toContain("[depth]");
  });

  it("caps long arrays", () => {
    const out = redact(Array.from({ length: 500 }, (_, i) => i)) as number[];
    expect(out).toHaveLength(50);
  });
});
