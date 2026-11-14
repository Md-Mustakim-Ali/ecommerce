import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Envelope encryption for the Google credentials in store_google_* .
 *
 * A refresh token is a bearer credential with no expiry that can read and
 * write a seller's Drive and upload to their channel. A database dump, a
 * mis-scoped backup or a `select *` in a support tool should not hand those
 * out, so they are encrypted at rest with a key that lives in the environment
 * rather than in Postgres.
 *
 * AES-256-GCM, because the alternative most people reach for — AES-CBC — is
 * unauthenticated, and an attacker who can write to the column can then flip
 * ciphertext bits and have the plaintext change under you. GCM's tag makes a
 * tampered value fail to decrypt instead.
 */

const VERSION = "v1";
const IV_BYTES = 12; // 96 bits, the size GCM is specified for
const TAG_BYTES = 16;
const KEY_BYTES = 32;

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "GOOGLE_TOKEN_ENCRYPTION_KEY is not set. Google account connections " +
        "cannot be stored without it.\n" +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }

  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== KEY_BYTES) {
    throw new Error(
      `GOOGLE_TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${decoded.length}. ` +
        "It should be base64 of 32 random bytes.",
    );
  }

  cachedKey = decoded;
  return cachedKey;
}

/** Test seam. Resets the memoised key after the env var changes. */
export function resetEncryptionKeyCache(): void {
  cachedKey = null;
}

/**
 * Returns `v1.<base64(iv || tag || ciphertext)>`.
 *
 * The version prefix is what makes key rotation possible later without having
 * to guess how existing rows were produced.
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${VERSION}.${Buffer.concat([iv, tag, ciphertext]).toString("base64")}`;
}

export function decryptSecret(value: string): string {
  const separator = value.indexOf(".");
  if (separator === -1) {
    throw new Error("Malformed encrypted value: no version prefix.");
  }

  const version = value.slice(0, separator);
  if (version !== VERSION) {
    throw new Error(`Unsupported encryption version: ${version}`);
  }

  const payload = Buffer.from(value.slice(separator + 1), "base64");
  // Strictly less than, not <=: an empty plaintext encrypts to an IV and a tag
  // with no ciphertext between them, and that is a valid value to round-trip.
  if (payload.length < IV_BYTES + TAG_BYTES) {
    throw new Error("Malformed encrypted value: payload too short.");
  }

  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Constant-time compare, for the webhook-style secrets this module's callers
 * end up needing next to it. Length is not secret; content is.
 */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
