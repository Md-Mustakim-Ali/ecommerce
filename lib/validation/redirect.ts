/**
 * `?next=` comes from the URL, so it is attacker-controlled. Sending a user to
 * an arbitrary value after sign-in is an open redirect: a phishing page can
 * link to /sign-in?next=https://evil.example and inherit our domain's trust.
 *
 * Only same-origin absolute paths are allowed. Everything else falls back.
 */

/** C0 controls plus DEL. A newline here can smuggle a header past naive checks. */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function safeNextPath(value: unknown, fallback = "/account"): string {
  if (typeof value !== "string" || value.length === 0) return fallback;

  // Must be an absolute path: not a full URL, not scheme-relative.
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;

  // Some browsers normalise the backslash in "/\evil.example" into a host.
  if (value.includes("\\")) return fallback;

  if (hasControlChars(value)) return fallback;

  return value;
}
