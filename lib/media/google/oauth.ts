import { parseGoogleFailure } from "../errors";
import { GoogleApiError } from "../failover";

/**
 * Access tokens, obtained per grant.
 *
 * The credentials are split across the two pools deliberately: the client id
 * and secret belong to the seller's Cloud PROJECT, the refresh token belongs to
 * their ACCOUNT, and Google will only mint a token when the pair matches the
 * one that originally consented. That is the mechanical reason grants exist as
 * a table — a token minted through project A is not replayable against project
 * B, and trying returns invalid_grant.
 */

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export type GrantCredentials = {
  /** The project half. */
  clientId: string;
  clientSecret: string;
  /** The account half. */
  refreshToken: string;
};

export type AccessToken = {
  token: string;
  expiresAt: Date;
};

/**
 * Cached in memory, keyed by the grant that produced it.
 *
 * An access token lasts an hour and every API call needs one, so without this
 * a single product upload spends three round trips on tokens. Best-effort by
 * nature — the cache dies with the instance, and on a free tier that sleeps
 * that happens often. It is a saving, never a correctness assumption.
 */
const tokenCache = new Map<string, AccessToken>();

/** Refresh a minute early, so a token cannot expire mid-upload. */
const EXPIRY_SKEW_MS = 60_000;

export function clearTokenCache(): void {
  tokenCache.clear();
}

/**
 * Exchanges a refresh token for an access token.
 *
 * Throws GoogleApiError so the failover loop can tell the two failures apart:
 * `invalid_grant` kills only this pair, while `invalid_client` means the
 * project's credentials are wrong and every grant on it is dead.
 */
export async function fetchAccessToken(
  credentials: GrantCredentials,
): Promise<AccessToken> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const body = await readJson(response);

  if (!response.ok) {
    throw new GoogleApiError(
      parseGoogleFailure(response.status, body, response.headers),
    );
  }

  const payload = body as { access_token?: string; expires_in?: number };
  if (!payload.access_token) {
    throw new GoogleApiError({
      status: response.status,
      reason: "invalid_grant",
      message: "Token endpoint returned no access_token.",
    });
  }

  return {
    token: payload.access_token,
    expiresAt: new Date(Date.now() + (payload.expires_in ?? 3600) * 1000),
  };
}

export async function accessTokenForGrant(
  grantId: string,
  credentials: GrantCredentials,
  now: Date = new Date(),
): Promise<string> {
  const cached = tokenCache.get(grantId);
  if (cached && cached.expiresAt.getTime() - EXPIRY_SKEW_MS > now.getTime()) {
    return cached.token;
  }

  const fresh = await fetchAccessToken(credentials);
  tokenCache.set(grantId, fresh);
  return fresh.token;
}

/**
 * Google does not always send JSON — a 502 from a load balancer is HTML, and
 * a 204 is empty. Returning null rather than throwing keeps the error path
 * reporting the real status instead of a parse failure.
 */
export async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * A fetch that converts every non-2xx into a classifiable GoogleApiError.
 *
 * Everything talking to Google goes through here, so no call site can
 * accidentally swallow a quota error into a generic "upload failed" — which is
 * the failure that would make the whole failover design silently inert.
 */
export async function googleFetch(
  url: string,
  init: RequestInit & { accessToken: string },
): Promise<unknown> {
  const { accessToken, ...rest } = init;

  const response = await fetch(url, {
    ...rest,
    headers: {
      ...(rest.headers as Record<string, string> | undefined),
      authorization: `Bearer ${accessToken}`,
    },
  });

  const body = await readJson(response);

  if (!response.ok) {
    throw new GoogleApiError(
      parseGoogleFailure(response.status, body, response.headers),
    );
  }

  return body;
}
