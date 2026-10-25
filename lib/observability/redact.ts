/**
 * Redaction.
 *
 * Split from the logger so it is a pure function with no imports: it is the
 * part worth testing, and dragging the environment schema in would mean a
 * DATABASE_URL is required to test a regex.
 *
 * Logs are the least protected place data ends up — shipped to third parties,
 * kept for months, read by people who would never be granted database access.
 * A password or a session token in a log line is a credential leak that no
 * amount of database security prevents, so this errs heavily toward removing
 * too much.
 */

export type Fields = Record<string, unknown>;

/**
 * Keys whose values are never logged, matched case-insensitively anywhere in
 * the key name so `userPassword` and `X-Api-Key` are both caught.
 *
 * Deliberately broad. The cost of redacting something harmless is an unhelpful
 * log line; the cost of missing something is a credential in a third-party
 * system that has to be treated as compromised.
 */
const SECRET_KEY =
  /pass|secret|token|auth|cookie|session|key|card|cvv|pan|iban|ssn|otp|signature/i;

/** Values that look like a secret regardless of what the key is called. */
const SECRET_VALUE = [
  // A bare 13-19 digit run: a card number, however it got here.
  /\b\d{13,19}\b/,
  // JWT.
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
  // Common provider key prefixes.
  //
  // The class includes `_` because the live forms are sk_live_… and sk_test_…
  // — without it the match stops at the second underscore after four
  // characters, which made the most common secret in this set the one the
  // pattern let through. The test caught it; reading the regex did not.
  /\b(?:sk|pk|rk|whsec|re)_[A-Za-z0-9_]{16,}/,
];

const REDACTED = "[redacted]";

/**
 * Strips anything that looks like a credential.
 *
 * Recurses, because the interesting secrets are nested — a request body inside
 * an error inside a context object. Depth-capped so a cyclic or pathological
 * structure cannot hang the logger, which would turn logging into an outage.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";

  if (typeof value === "string") {
    return SECRET_VALUE.some((pattern) => pattern.test(value))
      ? REDACTED
      : value;
  }

  if (Array.isArray(value)) {
    // Capped: a thousand-element array in a log line is noise that costs money
    // to store and nobody reads.
    return value.slice(0, 50).map((entry) => redact(entry, depth + 1));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: String(redact(value.message, depth + 1)),
      // Only in development. A stack trace names internal paths and file
      // layout, which is free reconnaissance in a shared log system.
      stack: process.env.NODE_ENV === "production" ? undefined : value.stack,
    };
  }

  if (value && typeof value === "object") {
    const out: Fields = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = SECRET_KEY.test(key) ? REDACTED : redact(entry, depth + 1);
    }
    return out;
  }

  return value;
}
