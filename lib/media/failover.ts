import {
  classifyGoogleFailure,
  type GoogleFailure,
  shouldTryAnotherGrant,
} from "./errors";
import {
  type GrantCandidate,
  type MediaNeed,
  pickGrant,
  type Rejection,
} from "./picker";
import type { YouTubeOperation } from "./quota";

/**
 * The retry loop: pick a project+account pair, try, and route around whatever
 * broke.
 *
 * The subtle part is not the retrying, it is keeping the in-memory candidate
 * list honest between attempts. When a project reports quotaExceeded, every
 * OTHER grant on that same project is dead too — a seller with four accounts
 * authorised through one project has four grants that will all fail
 * identically. Excluding only the grant that happened to fail would march
 * through all four, and on YouTube each of those attempts is a further 1,600
 * units charged against a budget that is already gone.
 *
 * So a failure marks the pool member, not the attempt, and the marks are
 * applied to the local copy before picking again.
 */

/** Thrown by an attempt so the loop can read Google's reason. */
export class GoogleApiError extends Error {
  readonly failure: GoogleFailure;

  constructor(failure: GoogleFailure) {
    super(failure.message ?? `Google API error ${failure.status}`);
    this.name = "GoogleApiError";
    this.failure = failure;
  }
}

/**
 * Where state changes are persisted.
 *
 * A port rather than direct database calls, so the loop is testable without a
 * Postgres instance — and so the marks land as the loop discovers them rather
 * than in one write at the end, which would let a concurrent upload retry a
 * grant this one has already proved dead.
 */
export interface FailoverSink {
  markProject(input: {
    projectId: string;
    state: "quota_exhausted" | "invalid" | "disabled";
    retryAfter?: Date;
    reason: string;
  }): Promise<void>;

  markAccount(input: {
    accountId: string;
    state: "storage_full" | "rate_limited" | "revoked";
    cooldownUntil?: Date;
    reason: string;
  }): Promise<void>;

  markGrant(input: {
    grantId: string;
    state: "invalid";
    reason: string;
  }): Promise<void>;

  /** Charged BEFORE the call. See lib/media/quota.ts for why. */
  spendUnits(input: {
    projectId: string;
    operation: YouTubeOperation;
  }): Promise<void>;

  /** Records a grant that worked, for "last used" reporting. */
  markGrantUsed?(input: { grantId: string }): Promise<void>;
}

export type FailoverFailure =
  /** Nothing eligible, now or after the marks were applied. */
  | { reason: "no_capacity"; retryAt: Date | null; rejections: Rejection[] }
  /** Google's fault. The same pair will work shortly. */
  | { reason: "transient"; retryAt: Date; message: string }
  /** Bad input. No other pair would have done better. */
  | { reason: "rejected"; message: string }
  /** The loop hit its attempt ceiling. */
  | { reason: "exhausted_attempts"; message: string };

export type FailoverResult<T> =
  | { ok: true; value: T; grant: GrantCandidate }
  | ({ ok: false } & FailoverFailure);

const DEFAULT_MAX_ATTEMPTS = 6;
const UNKNOWN_ERROR_RETRY_SECONDS = 15;

/**
 * Applies a decision to the local candidate list.
 *
 * Returns a new array rather than mutating, so a caller reusing the candidates
 * for a second asset is not silently working from a list this call degraded.
 */
function applyMark(
  candidates: readonly GrantCandidate[],
  mark:
    | {
        scope: "project";
        id: string;
        state: GrantCandidate["projectState"];
        /**
         * Set when Google reported quotaExceeded.
         *
         * The flag alone is not enough. The picker deliberately treats
         * `quota_exhausted` as healed whenever the ledger says there are units
         * left, so that a stale row written before a reset does not idle the
         * pool. That means a mark that moves the flag without also emptying
         * the ledger has no effect at all, and the loop walks straight into
         * every other grant on the same dead project.
         *
         * Google is authoritative here: if it says the budget is gone, the
         * local count was wrong.
         */
        exhaustedUntil?: Date;
      }
    | {
        scope: "account";
        id: string;
        state: GrantCandidate["accountState"];
        cooldownUntil?: Date;
      }
    | { scope: "grant"; id: string },
): GrantCandidate[] {
  return candidates.map((candidate) => {
    if (mark.scope === "project" && candidate.projectId === mark.id) {
      return {
        ...candidate,
        projectState: mark.state,
        projectLedger: mark.exhaustedUntil
          ? {
              ...candidate.projectLedger,
              unitsUsed: candidate.projectLedger.dailyUnitLimit,
              unitsResetAt: mark.exhaustedUntil,
            }
          : candidate.projectLedger,
      };
    }
    if (mark.scope === "account" && candidate.accountId === mark.id) {
      return {
        ...candidate,
        accountState: mark.state,
        accountCooldownUntil:
          mark.cooldownUntil ?? candidate.accountCooldownUntil,
      };
    }
    if (mark.scope === "grant" && candidate.grantId === mark.id) {
      return { ...candidate, grantState: "invalid" as const };
    }
    return candidate;
  });
}

export async function runWithFailover<T>(input: {
  candidates: readonly GrantCandidate[];
  need: MediaNeed;
  now: Date;
  sink: FailoverSink;
  /** Does the actual work. Throws GoogleApiError to trigger failover. */
  attempt: (grant: GrantCandidate) => Promise<T>;
  maxAttempts?: number;
}): Promise<FailoverResult<T>> {
  const { need, now, sink, attempt } = input;
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  let candidates: GrantCandidate[] = [...input.candidates];
  const tried = new Set<string>();

  for (let round = 0; round < maxAttempts; round++) {
    const picked = pickGrant(candidates, need, now, tried);
    if (!picked.ok) {
      return {
        ok: false,
        reason: "no_capacity",
        retryAt: picked.retryAt,
        rejections: picked.rejections,
      };
    }

    const grant = picked.grant;
    tried.add(grant.grantId);

    // Charged before the call, deliberately. A crash between here and the
    // response over-counts, which costs a few hours of capacity; counting
    // afterwards under-counts, which means finding the ceiling by spending
    // 1,600 units on a request that was always going to be refused.
    if (need.kind === "youtube") {
      await sink.spendUnits({
        projectId: grant.projectId,
        operation: need.operation,
      });
    }

    try {
      const value = await attempt(grant);
      await sink.markGrantUsed?.({ grantId: grant.grantId });
      return { ok: true, value, grant };
    } catch (error) {
      if (!(error instanceof GoogleApiError)) {
        // A network blip or a bug. Neither is a reason to burn another 1,600
        // units guessing, so hand it back and let the sweeper retry.
        return {
          ok: false,
          reason: "transient",
          retryAt: new Date(now.getTime() + UNKNOWN_ERROR_RETRY_SECONDS * 1000),
          message: error instanceof Error ? error.message : String(error),
        };
      }

      const action = classifyGoogleFailure(error.failure, now);

      switch (action.action) {
        case "exhaust_project":
          await sink.markProject({
            projectId: grant.projectId,
            state: "quota_exhausted",
            retryAfter: action.retryAfter,
            reason: action.reason,
          });
          candidates = applyMark(candidates, {
            scope: "project",
            id: grant.projectId,
            state: "quota_exhausted",
            exhaustedUntil: action.retryAfter,
          });
          break;

        case "disable_project":
          await sink.markProject({
            projectId: grant.projectId,
            state: "invalid",
            reason: action.reason,
          });
          candidates = applyMark(candidates, {
            scope: "project",
            id: grant.projectId,
            state: "invalid",
          });
          break;

        case "fill_account":
          await sink.markAccount({
            accountId: grant.accountId,
            state: "storage_full",
            reason: action.reason,
          });
          candidates = applyMark(candidates, {
            scope: "account",
            id: grant.accountId,
            state: "storage_full",
          });
          break;

        case "cooldown_account":
          await sink.markAccount({
            accountId: grant.accountId,
            state: "rate_limited",
            cooldownUntil: action.until,
            reason: action.reason,
          });
          candidates = applyMark(candidates, {
            scope: "account",
            id: grant.accountId,
            state: "rate_limited",
            cooldownUntil: action.until,
          });
          break;

        case "revoke_account":
          await sink.markAccount({
            accountId: grant.accountId,
            state: "revoked",
            reason: action.reason,
          });
          candidates = applyMark(candidates, {
            scope: "account",
            id: grant.accountId,
            state: "revoked",
          });
          break;

        case "invalidate_grant":
          await sink.markGrant({
            grantId: grant.grantId,
            state: "invalid",
            reason: action.reason,
          });
          candidates = applyMark(candidates, {
            scope: "grant",
            id: grant.grantId,
          });
          break;

        case "retry_same":
          // The credentials are still the right ones, so this does not belong
          // to the failover loop.
          return {
            ok: false,
            reason: "transient",
            retryAt: action.after,
            message: action.reason,
          };

        case "fail":
          return { ok: false, reason: "rejected", message: action.reason };
      }

      if (!shouldTryAnotherGrant(action)) {
        return { ok: false, reason: "rejected", message: action.reason };
      }
    }
  }

  return {
    ok: false,
    reason: "exhausted_attempts",
    message: `Gave up after ${maxAttempts} attempts.`,
  };
}
