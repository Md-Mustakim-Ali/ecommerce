import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  resetEncryptionKeyCache,
  secretsMatch,
} from "./crypto";

const original = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;

beforeEach(() => {
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  resetEncryptionKeyCache();
});

afterEach(() => {
  if (original === undefined) delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  else process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = original;
  resetEncryptionKeyCache();
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a refresh token", () => {
    const token = "1//0eXaMpLe-refresh-token_with.punctuation";
    expect(decryptSecret(encryptSecret(token))).toBe(token);
  });

  it("round-trips non-ASCII and empty values", () => {
    expect(decryptSecret(encryptSecret("দোকান"))).toBe("দোকান");
    expect(decryptSecret(encryptSecret(""))).toBe("");
  });

  it("produces a different ciphertext each time", () => {
    // A fresh IV per call. Deterministic output would leak that two sellers
    // had connected the same account.
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it("carries a version prefix so the format can be rotated later", () => {
    expect(encryptSecret("x").startsWith("v1.")).toBe(true);
  });

  it("refuses a tampered ciphertext instead of returning garbage", () => {
    // The reason for GCM over CBC: someone able to write to the column must
    // not be able to flip bits and have the plaintext change under us.
    const value = encryptSecret("refresh-token");
    const payload = Buffer.from(value.slice(3), "base64");
    payload[payload.length - 1] ^= 0xff;
    const tampered = `v1.${payload.toString("base64")}`;
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("refuses an unknown version", () => {
    expect(() => decryptSecret("v2.abcdef")).toThrow(
      /Unsupported encryption version/,
    );
  });

  it("refuses a malformed value", () => {
    expect(() => decryptSecret("no-prefix")).toThrow(/no version prefix/);
    expect(() => decryptSecret("v1.aGk=")).toThrow(/too short/);
  });

  it("cannot be decrypted with a different key", () => {
    const value = encryptSecret("refresh-token");
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY =
      randomBytes(32).toString("base64");
    resetEncryptionKeyCache();
    expect(() => decryptSecret(value)).toThrow();
  });
});

describe("key validation", () => {
  it("explains a missing key rather than throwing from deep in node:crypto", () => {
    delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    resetEncryptionKeyCache();
    expect(() => encryptSecret("x")).toThrow(
      /GOOGLE_TOKEN_ENCRYPTION_KEY is not set/,
    );
  });

  it("rejects a key of the wrong length", () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY =
      randomBytes(16).toString("base64");
    resetEncryptionKeyCache();
    expect(() => encryptSecret("x")).toThrow(/must decode to 32 bytes, got 16/);
  });
});

describe("secretsMatch", () => {
  it("compares by content", () => {
    expect(secretsMatch("abc", "abc")).toBe(true);
    expect(secretsMatch("abc", "abd")).toBe(false);
  });

  it("returns false on a length mismatch instead of throwing", () => {
    // timingSafeEqual throws on unequal lengths; the guard has to come first.
    expect(secretsMatch("short", "much longer value")).toBe(false);
  });
});
