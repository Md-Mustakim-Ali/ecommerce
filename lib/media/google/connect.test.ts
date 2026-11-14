import { describe, expect, it } from "vitest";
import {
  buildConsentUrl,
  type ConnectState,
  GOOGLE_SCOPES,
  missingScopes,
  readIdentityFromIdToken,
  signConnectState,
  verifyConnectState,
} from "./connect";

const SECRET = "a-test-secret-at-least-32-characters-long";
const now = new Date("2026-01-15T20:00:00Z");

const state = (overrides: Partial<ConnectState> = {}): ConnectState => ({
  storeId: "0193c3e0-0000-7000-8000-000000000001",
  projectId: "0193c3e0-0000-7000-8000-000000000002",
  exp: Math.floor(now.getTime() / 1000) + 600,
  ...overrides,
});

describe("connect state", () => {
  it("round-trips", () => {
    const signed = signConnectState(state(), SECRET);
    const verified = verifyConnectState(signed, SECRET, now);
    expect(verified).toMatchObject({
      storeId: state().storeId,
      projectId: state().projectId,
    });
  });

  it("rejects a tampered payload", () => {
    // Google echoes state back verbatim. Without this, a crafted callback URL
    // attaches an attacker's Google account to somebody else's store, and the
    // store's product photos start uploading into the attacker's Drive.
    const signed = signConnectState(state(), SECRET);
    const [payload, signature] = signed.split(".");
    const forged = Buffer.from(
      JSON.stringify(state({ storeId: "attacker-store" })),
      "utf8",
    ).toString("base64url");

    expect(
      verifyConnectState(`${forged}.${signature}`, SECRET, now),
    ).toBeNull();
    expect(verifyConnectState(`${payload}.deadbeef`, SECRET, now)).toBeNull();
  });

  it("rejects a signature from a different secret", () => {
    const signed = signConnectState(state(), "some-other-secret-entirely-ok");
    expect(verifyConnectState(signed, SECRET, now)).toBeNull();
  });

  it("rejects an expired state", () => {
    const stale = signConnectState(
      state({ exp: Math.floor(now.getTime() / 1000) - 1 }),
      SECRET,
    );
    expect(verifyConnectState(stale, SECRET, now)).toBeNull();
  });

  it("rejects malformed tokens without throwing", () => {
    for (const bad of ["", "no-dot", ".", "a.b.c.d", "!!!.???"]) {
      expect(verifyConnectState(bad, SECRET, now)).toBeNull();
    }
  });

  it("rejects a well-signed payload that is missing fields", () => {
    const payload = Buffer.from(JSON.stringify({ storeId: "x" })).toString(
      "base64url",
    );
    const signed = signConnectState(state(), SECRET);
    const signature = signed.split(".")[1];
    expect(
      verifyConnectState(`${payload}.${signature}`, SECRET, now),
    ).toBeNull();
  });
});

describe("buildConsentUrl", () => {
  const url = () =>
    new URL(
      buildConsentUrl({
        clientId: "client-123.apps.googleusercontent.com",
        redirectUri: "https://shop.example/api/google/callback",
        state: "signed-state",
      }),
    );

  it("targets Google's consent screen with the project's own client", () => {
    const parsed = url();
    expect(parsed.origin + parsed.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(parsed.searchParams.get("client_id")).toBe(
      "client-123.apps.googleusercontent.com",
    );
  });

  it("always asks for offline access AND forces the consent screen", () => {
    // Google only returns a refresh token on the first consent for a
    // client/account pair. Without prompt=consent, a seller reconnecting an
    // account gets an access token, no refresh token, and a grant that dies
    // in an hour for no visible reason.
    const parsed = url();
    expect(parsed.searchParams.get("access_type")).toBe("offline");
    expect(parsed.searchParams.get("prompt")).toBe("consent");
  });

  it("requests exactly the documented scopes", () => {
    const scopes = url().searchParams.get("scope")?.split(" ") ?? [];
    expect(scopes).toEqual([...GOOGLE_SCOPES]);
    // drive.file, not drive: app-created files only, which keeps the app out
    // of Google's restricted-scope security assessment.
    expect(scopes).toContain("https://www.googleapis.com/auth/drive.file");
    expect(scopes).not.toContain("https://www.googleapis.com/auth/drive");
  });

  it("carries the signed state through", () => {
    expect(url().searchParams.get("state")).toBe("signed-state");
  });
});

describe("readIdentityFromIdToken", () => {
  const encode = (claims: unknown) =>
    `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;

  it("reads sub and email", () => {
    const identity = readIdentityFromIdToken(
      encode({ sub: "1234567890", email: "shop@example.com" }),
    );
    expect(identity).toEqual({ sub: "1234567890", email: "shop@example.com" });
  });

  it("returns null when claims are incomplete", () => {
    expect(readIdentityFromIdToken(encode({ sub: "123" }))).toBeNull();
    expect(readIdentityFromIdToken(encode({ email: "a@b.c" }))).toBeNull();
  });

  it("returns null for a malformed token rather than throwing", () => {
    expect(readIdentityFromIdToken("not-a-jwt")).toBeNull();
    expect(readIdentityFromIdToken("a.b")).toBeNull();
    expect(readIdentityFromIdToken("a.!!!not-base64!!!.c")).toBeNull();
  });
});

describe("missingScopes", () => {
  it("is empty when everything was granted", () => {
    expect(missingScopes(GOOGLE_SCOPES.join(" "))).toEqual([]);
  });

  it("names what the seller unticked", () => {
    // Google's consent screen lets a user grant a subset, so the app has to
    // check rather than assume — otherwise the first upload is where they
    // find out.
    const granted = [
      "openid",
      "email",
      "https://www.googleapis.com/auth/drive.file",
    ].join(" ");

    expect(missingScopes(granted)).toEqual([
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly",
    ]);
  });

  it("does not complain about identity scopes", () => {
    expect(missingScopes(GOOGLE_SCOPES.join(" "))).not.toContain("openid");
  });
});
