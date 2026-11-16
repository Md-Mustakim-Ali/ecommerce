/**
 * Deciding whether a URL a seller pasted is safe for this server to fetch.
 *
 * Pasting an image link means the server makes a request to an address the
 * seller chose, which is the definition of SSRF. The address that matters most
 * is not a private LAN host but 169.254.169.254 — the cloud metadata endpoint,
 * which on many providers hands out credentials to anything that asks from
 * inside the instance. A seller who pastes it would get the response ingested
 * into their own product gallery.
 *
 * So the rule is an allowlist of schemes and a denylist of address ranges,
 * applied to the resolved address rather than the hostname. Checking the
 * hostname alone is not enough: `evil.test` can simply have an A record
 * pointing at 127.0.0.1.
 */

export type UrlRejection =
  | "scheme"
  | "malformed"
  | "credentials"
  | "port"
  | "private-address";

export type UrlCheck =
  | { ok: true; url: URL }
  | { ok: false; reason: UrlRejection; message: string };

/**
 * Ports worth allowing. Anything else on a public host is far more likely to
 * be an attempt to reach an internal service than a picture.
 */
const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

function ipv4ToInt(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    // Reject "01" and "0x7f" style octets: they parse differently in different
    // resolvers, which is exactly how a denylist gets walked past.
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** Ranges that must never be reachable from a seller-supplied URL. */
const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, and cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
];

export function isBlockedIpv4(address: string): boolean {
  const value = ipv4ToInt(address);
  if (value === null) return false;

  for (const [base, bits] of BLOCKED_V4) {
    const baseValue = ipv4ToInt(base);
    if (baseValue === null) continue;
    const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
    if ((value & mask) >>> 0 === (baseValue & mask) >>> 0) return true;
  }
  return false;
}

export function isBlockedIpv6(address: string): boolean {
  const lower = address.toLowerCase().replace(/^\[|\]$/g, "");

  if (lower === "::" || lower === "::1") return true;
  // Unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd]/.test(lower)) return true;
  if (/^fe[89ab]/.test(lower)) return true;

  // IPv4-mapped and IPv4-compatible forms smuggle a v4 address through a v6
  // literal, so unwrap and apply the v4 rules.
  const mapped = lower.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);

  return false;
}

export function isBlockedAddress(address: string): boolean {
  return address.includes(":")
    ? isBlockedIpv6(address)
    : isBlockedIpv4(address);
}

/**
 * Everything that can be judged from the URL text alone.
 *
 * Whether the hostname *resolves* to a blocked address is a separate,
 * asynchronous question — see assertResolvesPublicly — but a literal IP, a
 * bad scheme or embedded credentials are all decidable here and cheaper to
 * reject before any DNS happens.
 */
export function checkRemoteUrl(input: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return {
      ok: false,
      reason: "malformed",
      message: "That does not look like a web address.",
    };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      reason: "scheme",
      message: "Only http and https links can be used.",
    };
  }

  // user:pass@host is a classic way to make a URL read as one host while
  // resolving as another.
  if (url.username || url.password) {
    return {
      ok: false,
      reason: "credentials",
      message: "Links with a username or password are not allowed.",
    };
  }

  if (!ALLOWED_PORTS.has(url.port)) {
    return {
      ok: false,
      reason: "port",
      message: "Only standard web ports are allowed.",
    };
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    return {
      ok: false,
      reason: "private-address",
      message: "That address is not reachable from the internet.",
    };
  }

  if (isBlockedAddress(host)) {
    return {
      ok: false,
      reason: "private-address",
      message: "That address is not reachable from the internet.",
    };
  }

  return { ok: true, url };
}

/** What a fetched remote image is allowed to be. */
export const REMOTE_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
] as const;

export const MAX_REMOTE_BYTES = 8 * 1024 * 1024;

export type RemoteImageCheck =
  | { ok: true; contentType: string }
  | { ok: false; message: string };

/**
 * Judges the response before its body is read.
 *
 * Content-Length is advisory — a hostile server can lie or omit it — so the
 * read itself is capped as well. This is the cheap check that avoids
 * downloading eight megabytes to discover it was an HTML page.
 */
export function checkRemoteImageResponse(headers: {
  get(name: string): string | null;
}): RemoteImageCheck {
  const contentType = (headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (!(REMOTE_IMAGE_TYPES as readonly string[]).includes(contentType)) {
    return {
      ok: false,
      message: contentType
        ? `That link returned ${contentType}, not an image.`
        : "That link did not return an image.",
    };
  }

  const declared = Number(headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > MAX_REMOTE_BYTES) {
    return {
      ok: false,
      message: `That image is ${(declared / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_REMOTE_BYTES / 1024 / 1024} MB.`,
    };
  }

  return { ok: true, contentType };
}

/**
 * A filename for the stored copy, derived from the URL's own path.
 *
 * The result is handed to a Drive upload, so it has to be a plain name.
 * Stripping separators alone is not enough — a percent-encoded
 * `..%2F..%2Fetc%2Fpasswd` survives that as `..2F..2Fetc2Fpasswd`, which still
 * leads with a traversal sequence. Runs of dots collapse to one.
 */
export function filenameFromUrl(url: URL, contentType: string): string {
  const fromPath = decodeURIComponent(
    url.pathname.split("/").filter(Boolean).at(-1) ?? "",
  );
  const cleaned = fromPath
    .replace(/[^\w.-]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.-]+/, "")
    .slice(0, 80);

  if (cleaned.includes(".")) return cleaned;

  const extension = contentType.split("/")[1] ?? "jpg";
  return `${cleaned || "image"}.${extension}`;
}
