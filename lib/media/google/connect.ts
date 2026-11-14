import { createHmac, timingSafeEqual } from "node:crypto";
import { parseGoogleFailure } from "../errors";
import { GoogleApiError } from "../failover";
import { DRIVE_SCOPE } from "./drive";
import { readJson } from "./oauth";

/**
 * Connecting a Google account to a store, through one of its Cloud projects.
 *
 * The consent screen is the seller's own project's, which is what makes the
 * whole per-project quota model work — and also what the seller sees, so the
 * app name on it is theirs rather than ours.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/**
 * Scopes, kept as small as the feature allows.
 *
 * drive.file is the important one: it grants access only to files this app
 * created, so a bug here cannot read a seller's personal documents — they are
 * invisible to the token. The alternative, full `drive`, is a restricted scope
 * requiring Google's security assessment, which costs weeks and money and asks
 * shop owners to hand over their entire Drive.
 *
 * The YouTube scopes are what force a verification review. There is no smaller
 * pair that permits uploading and then checking whether the upload worked.
 */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  DRIVE_SCOPE,
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
] as const;

// ── State: CSRF protection across the redirect ────────────────────────────

export type ConnectState = {
  storeId: string;
  projectId: string;
  /** Unix seconds. */
  exp: number;
};

function hmac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * Signs the state parameter.
 *
 * Google echoes `state` back verbatim, so without a signature anyone could
 * send a seller a crafted callback URL and have their own Google account
 * attached to that seller's store — which would mean the store's product media
 * silently uploading into an attacker's Drive.
 *
 * The expiry is short because the value only has to survive one consent screen.
 */
export function signConnectState(state: ConnectState, secret: string): string {
  const payload = Buffer.from(JSON.stringify(state), "utf8").toString(
    "base64url",
  );
  return `${payload}.${hmac(payload, secret)}`;
}

export function verifyConnectState(
  token: string,
  secret: string,
  now: Date = new Date(),
): ConnectState | null {
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = hmac(payload, secret);

  const given = Buffer.from(signature, "utf8");
  const want = Buffer.from(expected, "utf8");
  if (given.length !== want.length) return null;
  if (!timingSafeEqual(given, want)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const state = parsed as Partial<ConnectState>;
  if (
    typeof state.storeId !== "string" ||
    typeof state.projectId !== "string" ||
    typeof state.exp !== "number"
  ) {
    return null;
  }

  if (state.exp * 1000 <= now.getTime()) return null;

  return { storeId: state.storeId, projectId: state.projectId, exp: state.exp };
}

// ── The consent URL ───────────────────────────────────────────────────────

export function buildConsentUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  url.searchParams.set("state", input.state);

  // offline + consent, together, every time. Google only returns a refresh
  // token on the FIRST consent for a client/account pair; a seller
  // reconnecting an account they have connected before would otherwise get an
  // access token, no refresh token, and a grant that stops working in an hour
  // with no obvious cause.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");

  // Lets Google grant a subset. The app must then check what it actually got
  // rather than assuming, which is what missingScopes is for.
  url.searchParams.set("include_granted_scopes", "true");

  return url.toString();
}

// ── The callback exchange ─────────────────────────────────────────────────

export type ConnectedIdentity = {
  refreshToken: string;
  grantedScopes: string;
  googleUserId: string;
  email: string;
};

/**
 * Reads the identity out of an id_token without verifying its signature.
 *
 * Normally unforgivable. It is safe in exactly this position: the token came
 * back in the body of a TLS response to a request this server made to Google's
 * token endpoint, authenticated with the project's client secret. There is no
 * untrusted party in that path — signature verification would only be
 * re-proving the transport.
 */
export function readIdentityFromIdToken(
  idToken: string,
): { sub: string; email: string } | null {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;

  try {
    const claims = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as { sub?: string; email?: string };

    if (!claims.sub || !claims.email) return null;
    return { sub: claims.sub, email: claims.email };
  } catch {
    return null;
  }
}

/** Scopes that were asked for but not granted. */
export function missingScopes(granted: string): string[] {
  const have = new Set(granted.split(/\s+/).filter(Boolean));
  return GOOGLE_SCOPES.filter(
    (scope) => scope !== "openid" && scope !== "email" && !have.has(scope),
  );
}

export async function exchangeCodeForRefreshToken(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<ConnectedIdentity> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const body = await readJson(response);

  if (!response.ok) {
    throw new GoogleApiError(
      parseGoogleFailure(response.status, body, response.headers),
    );
  }

  const payload = body as {
    refresh_token?: string;
    id_token?: string;
    scope?: string;
  };

  if (!payload.refresh_token) {
    // Almost always a re-consent that Google answered without a refresh token.
    // buildConsentUrl sends prompt=consent to prevent it, so reaching here
    // means something stripped the parameter.
    throw new GoogleApiError({
      status: response.status,
      reason: "invalid_grant",
      message:
        "Google did not return a refresh token. Remove the app from your Google account permissions and connect again.",
    });
  }

  const identity = payload.id_token
    ? readIdentityFromIdToken(payload.id_token)
    : null;

  if (!identity) {
    throw new GoogleApiError({
      status: response.status,
      message: "Could not read the Google account's identity.",
    });
  }

  return {
    refreshToken: payload.refresh_token,
    grantedScopes: payload.scope ?? "",
    googleUserId: identity.sub,
    email: identity.email,
  };
}
