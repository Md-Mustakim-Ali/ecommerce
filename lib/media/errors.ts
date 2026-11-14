import { nextQuotaResetAt } from "./quota";

/**
 * Turning a Google API failure into "which pool member is broken".
 *
 * This is the part the whole two-pool design rests on. A seller saves several
 * Cloud projects and several Google accounts, and when an upload fails the
 * backend has to route around whichever one actually ran out — which means
 * telling apart four superficially identical 403s:
 *
 *   quotaExceeded        the PROJECT's 10,000 daily units are gone. Every
 *                        account on it fails identically, so switching account
 *                        is pointless; switching project is the only move.
 *   storageQuotaExceeded the ACCOUNT's Drive is full. Every project pointed at
 *                        it fails, so switch account and keep the project.
 *   uploadLimitExceeded  the ACCOUNT's channel hit its daily video cap. Same
 *                        remedy, different clock — it is a daily limit, so the
 *                        cooldown runs to the next reset rather than a minute.
 *   invalid_grant        just this PAIR. The account is very likely fine
 *                        through a different project, so only the grant dies.
 *
 * Get this mapping wrong and the failover either gives up while capacity is
 * sitting there unused, or marches through every account burning quota on a
 * failure none of them could have avoided.
 */

export type FailoverAction =
  /** Project is out of units until the daily reset. */
  | { action: "exhaust_project"; retryAfter: Date; reason: string }
  /** Project credentials are wrong. Needs the seller, not time. */
  | { action: "disable_project"; reason: string }
  /** This account's Drive is full. */
  | { action: "fill_account"; reason: string }
  /** Account is throttled or capped. Clears on its own. */
  | { action: "cooldown_account"; until: Date; reason: string }
  /** Account-level authorisation is gone entirely. */
  | { action: "revoke_account"; reason: string }
  /** Only this project+account pair is broken. */
  | { action: "invalidate_grant"; reason: string }
  /** Google's fault. Same credentials will work shortly. */
  | { action: "retry_same"; after: Date; reason: string }
  /** Nothing to route around — bad request, unsupported file, etc. */
  | { action: "fail"; reason: string };

export type GoogleFailure = {
  status: number;
  /** Machine reason, e.g. "quotaExceeded". Absent on some responses. */
  reason?: string;
  message?: string;
  /** Seconds, from the Retry-After header when Google sends one. */
  retryAfterSeconds?: number;
};

const DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS = 60;
const DEFAULT_BACKEND_RETRY_SECONDS = 15;

/**
 * Normalises the three different error envelopes Google actually returns.
 *
 * The token endpoint speaks OAuth's flat `{error, error_description}`, the
 * Drive and YouTube JSON APIs speak `{error: {errors: [{reason}]}}`, and newer
 * responses carry a gRPC-style `{error: {status: "RESOURCE_EXHAUSTED"}}`. Code
 * that only knows one of them silently loses the reason and falls through to a
 * generic failure, which is how a recoverable quota error turns into a dead
 * upload.
 */
export function parseGoogleFailure(
  status: number,
  body: unknown,
  headers?: { get(name: string): string | null },
): GoogleFailure {
  const retryAfterRaw = headers?.get("retry-after") ?? null;
  const parsedRetryAfter = retryAfterRaw ? Number(retryAfterRaw) : Number.NaN;
  const retryAfterSeconds = Number.isFinite(parsedRetryAfter)
    ? parsedRetryAfter
    : undefined;

  const base: GoogleFailure = { status, retryAfterSeconds };

  if (typeof body !== "object" || body === null) return base;
  const error = (body as { error?: unknown }).error;

  // OAuth token endpoint: { "error": "invalid_grant", "error_description": … }
  if (typeof error === "string") {
    return {
      ...base,
      reason: error,
      message:
        (body as { error_description?: string }).error_description ?? error,
    };
  }

  if (typeof error !== "object" || error === null) return base;

  const detail = error as {
    message?: string;
    status?: string;
    errors?: { reason?: string; message?: string }[];
  };

  const nested = Array.isArray(detail.errors) ? detail.errors[0] : undefined;

  return {
    ...base,
    reason: nested?.reason ?? detail.status,
    message: nested?.message ?? detail.message,
  };
}

/**
 * The routing decision for one failed call.
 *
 * `now` is injected rather than read from the clock so the cooldown maths is
 * testable, and so a retry window cannot drift between the decision and the
 * write that records it.
 */
export function classifyGoogleFailure(
  failure: GoogleFailure,
  now: Date,
): FailoverAction {
  const reason = failure.reason ?? "";
  const message = failure.message ?? reason ?? `HTTP ${failure.status}`;

  switch (reason) {
    // ── Project axis ──────────────────────────────────────────────────────
    //
    // Charged to the OAuth client, so no account on this project can help.
    case "quotaExceeded":
    case "dailyLimitExceeded":
      return {
        action: "exhaust_project",
        retryAfter: nextQuotaResetAt(now),
        reason: message,
      };

    // Wrong client id/secret, or the project has the API switched off. Time
    // does not fix either.
    case "invalid_client":
    case "unauthorized_client":
    case "accessNotConfigured":
    case "SERVICE_DISABLED":
      return { action: "disable_project", reason: message };

    // ── Account axis ──────────────────────────────────────────────────────
    case "storageQuotaExceeded":
      return { action: "fill_account", reason: message };

    // A daily per-channel cap, so it clears at the daily boundary rather than
    // in a minute. Treating it as an ordinary throttle would retry all day.
    case "uploadLimitExceeded":
      return {
        action: "cooldown_account",
        until: nextQuotaResetAt(now),
        reason: message,
      };

    case "rateLimitExceeded":
    case "userRateLimitExceeded":
      return {
        action: "cooldown_account",
        until: new Date(
          now.getTime() +
            (failure.retryAfterSeconds ?? DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS) *
              1000,
        ),
        reason: message,
      };

    // The account has no YouTube channel. Another project will not conjure
    // one, so the account is unusable for video until the seller creates it.
    case "youtubeSignupRequired":
      return { action: "fill_account", reason: message };

    // ── Grant axis ────────────────────────────────────────────────────────
    //
    // The refresh token is dead. Scoped to the pair, because the same account
    // authorised through a different project holds a different token that is
    // very likely still good.
    case "invalid_grant":
    case "authError":
      return { action: "invalidate_grant", reason: message };

    // ── Transient ─────────────────────────────────────────────────────────
    case "backendError":
    case "internalError":
    case "UNAVAILABLE":
      return {
        action: "retry_same",
        after: new Date(now.getTime() + DEFAULT_BACKEND_RETRY_SECONDS * 1000),
        reason: message,
      };
  }

  // No usable reason string. Fall back to the status code, which is coarser
  // but still separates "try someone else" from "this will never work".
  if (failure.status === 401) {
    return { action: "invalidate_grant", reason: message };
  }
  if (failure.status === 429) {
    return {
      action: "cooldown_account",
      until: new Date(
        now.getTime() +
          (failure.retryAfterSeconds ?? DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS) *
            1000,
      ),
      reason: message,
    };
  }
  if (failure.status >= 500) {
    return {
      action: "retry_same",
      after: new Date(
        now.getTime() +
          (failure.retryAfterSeconds ?? DEFAULT_BACKEND_RETRY_SECONDS) * 1000,
      ),
      reason: message,
    };
  }

  return { action: "fail", reason: message };
}

/**
 * Whether the caller should pick a different grant and try again.
 *
 * `retry_same` is deliberately false: the same credentials are still the right
 * ones, so that case belongs to a bounded retry around a single attempt, not
 * to the failover loop.
 */
export function shouldTryAnotherGrant(action: FailoverAction): boolean {
  switch (action.action) {
    case "exhaust_project":
    case "disable_project":
    case "fill_account":
    case "cooldown_account":
    case "revoke_account":
    case "invalidate_grant":
      return true;
    case "retry_same":
    case "fail":
      return false;
  }
}
