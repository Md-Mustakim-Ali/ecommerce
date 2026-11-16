import { describe, expect, it } from "vitest";
import {
  checkRemoteImageResponse,
  checkRemoteUrl,
  filenameFromUrl,
  isBlockedAddress,
  MAX_REMOTE_BYTES,
} from "./remote-url";

/**
 * These are security tests, not validation tests.
 *
 * Pasting an image link makes this server fetch an address the seller chose.
 * Every case below is a way that has historically been turned into reading
 * something the server was never meant to expose.
 */

const headers = (values: Record<string, string>) => ({
  get: (name: string) => values[name.toLowerCase()] ?? null,
});

describe("isBlockedAddress", () => {
  it("blocks loopback", () => {
    for (const address of ["127.0.0.1", "127.1.2.3", "::1"]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it("blocks the cloud metadata endpoint", () => {
    // The one that matters most: on many providers this hands out instance
    // credentials to anything that asks from inside the box.
    expect(isBlockedAddress("169.254.169.254")).toBe(true);
  });

  it("blocks every private range", () => {
    for (const address of [
      "10.0.0.1",
      "10.255.255.255",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1",
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it("blocks IPv6 unique-local and link-local", () => {
    for (const address of ["fc00::1", "fd12:3456::1", "fe80::1"]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it("blocks a v4 address smuggled inside a v6 literal", () => {
    // ::ffff:127.0.0.1 is loopback wearing a different hat.
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedAddress("::ffff:169.254.169.254")).toBe(true);
  });

  it("does not block ordinary public addresses", () => {
    for (const address of [
      "8.8.8.8",
      "1.1.1.1",
      "172.32.0.1",
      "9.255.255.255",
    ]) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });

  it("does not itself try to interpret octal octets", () => {
    // Deliberately literal: "0177.0.0.1" is not a decimal dotted quad, so this
    // function declines to guess. The guarantee comes from the layer above.
    expect(isBlockedAddress("0177.0.0.1")).toBe(false);
  });

  it("still blocks octal loopback, because URL parsing normalises it first", () => {
    // WHATWG URL resolves 0177.0.0.1 to 127.0.0.1 before the denylist sees it,
    // so the notation that bypasses naive string checks is caught here.
    const result = checkRemoteUrl("http://0177.0.0.1/a.png");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("private-address");
  });

  it("blocks the integer form of loopback too", () => {
    // http://2130706433/ is another spelling of 127.0.0.1.
    expect(checkRemoteUrl("http://2130706433/a.png").ok).toBe(false);
  });
});

describe("checkRemoteUrl", () => {
  it("accepts an ordinary https image link", () => {
    const result = checkRemoteUrl("https://images.example.com/shirt.jpg");
    expect(result.ok).toBe(true);
  });

  it("refuses non-web schemes", () => {
    for (const bad of [
      "file:///etc/passwd",
      "ftp://example.com/a.png",
      "gopher://example.com",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
    ]) {
      const result = checkRemoteUrl(bad);
      expect(result.ok, bad).toBe(false);
      if (!result.ok) expect(result.reason).toBe("scheme");
    }
  });

  it("refuses embedded credentials", () => {
    // Reads as one host, resolves as another.
    const result = checkRemoteUrl("https://images.example.com@127.0.0.1/a.png");
    expect(result.ok).toBe(false);
  });

  it("refuses loopback and metadata by literal address", () => {
    for (const bad of [
      "http://127.0.0.1/a.png",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/a.png",
      "http://192.168.0.5/a.png",
    ]) {
      const result = checkRemoteUrl(bad);
      expect(result.ok, bad).toBe(false);
      if (!result.ok) expect(result.reason).toBe("private-address");
    }
  });

  it("refuses hostnames that only exist inside a network", () => {
    for (const bad of [
      "http://localhost/a.png",
      "http://db.internal/a.png",
      "http://printer.local/a.png",
    ]) {
      expect(checkRemoteUrl(bad).ok, bad).toBe(false);
    }
  });

  it("refuses non-web ports", () => {
    // 6379 is Redis, 5432 is Postgres. Neither serves pictures.
    for (const bad of [
      "http://example.com:6379/a.png",
      "http://example.com:5432/a.png",
      "http://example.com:22/a.png",
    ]) {
      const result = checkRemoteUrl(bad);
      expect(result.ok, bad).toBe(false);
      if (!result.ok) expect(result.reason).toBe("port");
    }
  });

  it("allows the standard web ports", () => {
    for (const good of [
      "https://example.com:443/a.png",
      "http://example.com:80/a.png",
      "https://example.com:8443/a.png",
    ]) {
      expect(checkRemoteUrl(good).ok, good).toBe(true);
    }
  });

  it("refuses nonsense rather than throwing", () => {
    for (const bad of ["", "   ", "not a url", "http://"]) {
      expect(checkRemoteUrl(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("checkRemoteImageResponse", () => {
  it("accepts the image types the platform stores", () => {
    for (const type of [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/avif",
    ]) {
      expect(
        checkRemoteImageResponse(headers({ "content-type": type })).ok,
        type,
      ).toBe(true);
    }
  });

  it("tolerates a charset parameter", () => {
    expect(
      checkRemoteImageResponse(
        headers({ "content-type": "image/png; charset=binary" }),
      ).ok,
    ).toBe(true);
  });

  it("refuses anything that is not an image", () => {
    // A link to an HTML page is the common honest mistake; text/html from an
    // endpoint that was supposed to be a picture is the dishonest one.
    for (const type of ["text/html", "application/json", "image/svg+xml", ""]) {
      expect(
        checkRemoteImageResponse(headers({ "content-type": type })).ok,
        type,
      ).toBe(false);
    }
  });

  it("refuses an image that declares itself too large", () => {
    const result = checkRemoteImageResponse(
      headers({
        "content-type": "image/jpeg",
        "content-length": String(MAX_REMOTE_BYTES + 1),
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("accepts one that declares itself within the limit", () => {
    expect(
      checkRemoteImageResponse(
        headers({
          "content-type": "image/jpeg",
          "content-length": String(MAX_REMOTE_BYTES),
        }),
      ).ok,
    ).toBe(true);
  });
});

describe("filenameFromUrl", () => {
  it("keeps the name from the path", () => {
    expect(
      filenameFromUrl(new URL("https://x.test/photos/shirt.jpg"), "image/jpeg"),
    ).toBe("shirt.jpg");
  });

  it("adds an extension when the path has none", () => {
    expect(
      filenameFromUrl(new URL("https://x.test/photos/shirt"), "image/webp"),
    ).toBe("shirt.webp");
  });

  it("strips anything that is not a plain filename", () => {
    // The value reaches a Drive upload; path separators have no business in it.
    const name = filenameFromUrl(
      new URL("https://x.test/a/..%2F..%2Fetc%2Fpasswd"),
      "image/png",
    );
    expect(name).not.toContain("/");
    expect(name).not.toContain("..");
  });

  it("copes with a bare origin", () => {
    expect(filenameFromUrl(new URL("https://x.test/"), "image/png")).toBe(
      "image.png",
    );
  });
});
