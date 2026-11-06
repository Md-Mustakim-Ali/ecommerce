import {
  constructEvent,
  DEFAULT_TOLERANCE_SECONDS,
  SignatureVerificationError,
  signPayload,
} from "@jomma/sdk";
import { describe, expect, it } from "vitest";

/**
 * Webhook signature verification.
 *
 * This is the load-bearing security property of the whole Jomma integration.
 * The webhook is the only thing allowed to mark an order paid, so a forged one
 * is an unauthenticated instruction to ship goods and credit a seller. These
 * tests exist to catch the day somebody "simplifies" the verification, or adds
 * a development bypass, or starts parsing before checking.
 *
 * Verified against the real SDK rather than a reimplementation — a test of my
 * own copy of the algorithm would agree with itself while disagreeing with
 * Jomma.
 */

const SECRET = "whsec_test_only_never_a_real_secret";

function body(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: "evt_test_1",
    type: "payment.succeeded",
    created_at: new Date().toISOString(),
    data: {
      intent_id: "int_test_1",
      client_reference: "11111111-1111-4111-8111-111111111111",
      amount: 75604,
      received_amount: 75604,
      trx_id: "TRX123",
      ...overrides,
    },
  });
}

describe("jomma webhook signatures", () => {
  it("accepts a payload signed with the right secret", () => {
    const raw = body();
    const event = constructEvent(raw, signPayload(raw, SECRET), SECRET);

    expect(event.id).toBe("evt_test_1");
    expect(event.type).toBe("payment.succeeded");
    expect(event.data.received_amount).toBe(75604);
  });

  it("rejects a body altered after signing", () => {
    const raw = body();
    const signature = signPayload(raw, SECRET);

    // One digit. This is the actual attack: replay a real event with the
    // amount raised, or the client_reference pointed at somebody else's order.
    const tampered = raw.replace(
      '"received_amount":75604',
      '"received_amount":1',
    );

    expect(() => constructEvent(tampered, signature, SECRET)).toThrow(
      SignatureVerificationError,
    );
  });

  it("rejects a signature made with a different secret", () => {
    const raw = body();
    const forged = signPayload(raw, "whsec_attacker_guess");

    expect(() => constructEvent(raw, forged, SECRET)).toThrow(
      SignatureVerificationError,
    );
  });

  it("rejects a missing signature header", () => {
    const raw = body();

    // null and undefined both, because `headers.get()` returns null and an
    // object lookup returns undefined, and a truthiness check that let either
    // through would skip verification entirely.
    expect(() => constructEvent(raw, null, SECRET)).toThrow(
      SignatureVerificationError,
    );
    expect(() => constructEvent(raw, undefined, SECRET)).toThrow(
      SignatureVerificationError,
    );
  });

  it("rejects a malformed signature header", () => {
    const raw = body();

    for (const header of [
      "",
      "nonsense",
      "v1=deadbeef",
      "t=123",
      "t=abc,v1=",
    ]) {
      expect(() => constructEvent(raw, header, SECRET)).toThrow(
        SignatureVerificationError,
      );
    }
  });

  it("rejects a stale signature", () => {
    const raw = body();
    const now = Math.floor(Date.now() / 1000);

    // Correctly signed, just old. Without a timestamp check a signature
    // captured from a real delivery stays valid forever, so anyone who ever
    // sees one body can replay it indefinitely.
    const stale = signPayload(
      raw,
      SECRET,
      now - DEFAULT_TOLERANCE_SECONDS - 60,
    );

    expect(() => constructEvent(raw, stale, SECRET)).toThrow(
      SignatureVerificationError,
    );
  });

  it("accepts a signature inside the tolerance window", () => {
    const raw = body();
    const now = Math.floor(Date.now() / 1000);
    const recent = signPayload(raw, SECRET, now - 10);

    expect(() => constructEvent(raw, recent, SECRET)).not.toThrow();
  });

  it("rejects a signature from the future beyond tolerance", () => {
    const raw = body();
    const now = Math.floor(Date.now() / 1000);
    const ahead = signPayload(
      raw,
      SECRET,
      now + DEFAULT_TOLERANCE_SECONDS + 60,
    );

    expect(() => constructEvent(raw, ahead, SECRET)).toThrow(
      SignatureVerificationError,
    );
  });

  it("verifies the exact bytes, so re-serialising breaks it", () => {
    const raw = body();
    const signature = signPayload(raw, SECRET);

    // The mistake the SDK docs warn about, made concrete: parse, re-stringify
    // with different key order, and the same logical event no longer verifies.
    const parsed = JSON.parse(raw);
    const reordered = JSON.stringify({
      data: parsed.data,
      created_at: parsed.created_at,
      type: parsed.type,
      id: parsed.id,
    });

    expect(reordered).not.toBe(raw);
    expect(() => constructEvent(reordered, signature, SECRET)).toThrow(
      SignatureVerificationError,
    );
  });
});
