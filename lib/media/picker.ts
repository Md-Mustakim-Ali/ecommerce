import type { YouTubeOperation } from "./quota";
import { type QuotaLedger, unitsRemaining, YOUTUBE_COST } from "./quota";

/**
 * Choosing which project+account pair an upload should use.
 *
 * Deliberately pure: no database, no clock, no network. The failover rules are
 * the part of this feature most likely to be wrong in a way nobody notices —
 * an upload silently going to the wrong channel, or a seller told they are out
 * of capacity while a perfectly good account sits idle — and none of that is
 * testable if the logic can only run against live Google credentials.
 *
 * The caller loads candidates, calls pick(), attempts the upload, and on
 * failure marks whatever classifyGoogleFailure() blamed and picks again with
 * the failed grant excluded.
 */

export type GrantCandidate = {
  grantId: string;
  projectId: string;
  accountId: string;
  grantState: "active" | "invalid";

  projectState: "active" | "quota_exhausted" | "invalid" | "disabled";
  projectPriority: number;
  projectLedger: QuotaLedger;

  accountState:
    | "active"
    | "storage_full"
    | "rate_limited"
    | "revoked"
    | "disabled";
  accountPriority: number;
  accountCooldownUntil: Date | null;
  /** null means unmetered — a pooled or enterprise account. */
  storageLimitBytes: number | null;
  storageUsageBytes: number | null;
};

export type MediaNeed =
  | { kind: "youtube"; operation: YouTubeOperation }
  | { kind: "drive"; bytes: number };

export type RejectionReason =
  | "already_tried"
  | "grant_invalid"
  | "project_disabled"
  | "project_invalid"
  | "project_out_of_units"
  | "account_disabled"
  | "account_revoked"
  | "account_storage_full"
  | "account_rate_limited"
  | "account_storage_insufficient";

export type Rejection = {
  grantId: string;
  reason: RejectionReason;
  /** When this one becomes eligible again, if waiting is enough. */
  clearsAt: Date | null;
};

export type PickResult =
  | { ok: true; grant: GrantCandidate }
  | {
      ok: false;
      /** Null when nothing will clear on its own — the seller must act. */
      retryAt: Date | null;
      rejections: Rejection[];
    };

/** Whether a reason resolves with time rather than seller intervention. */
function clearsOnItsOwn(reason: RejectionReason): boolean {
  return reason === "project_out_of_units" || reason === "account_rate_limited";
}

/**
 * Screens one candidate, or explains why not.
 *
 * Both the project's exhausted flag and the account's rate-limit flag are
 * treated as healed once their deadline passes, without waiting for the
 * sweeper to write the row back. On a free instance that sleeps, the sweeper
 * may not have run for hours, and trusting a stale flag would idle the seller's
 * entire pool long after Google had forgiven them.
 */
function evaluate(
  candidate: GrantCandidate,
  need: MediaNeed,
  now: Date,
  alreadyTried: ReadonlySet<string>,
): Rejection | null {
  if (alreadyTried.has(candidate.grantId)) {
    return {
      grantId: candidate.grantId,
      reason: "already_tried",
      clearsAt: null,
    };
  }

  if (candidate.grantState === "invalid") {
    return {
      grantId: candidate.grantId,
      reason: "grant_invalid",
      clearsAt: null,
    };
  }

  // ── Account axis ─────────────────────────────────────────────────────────
  if (candidate.accountState === "disabled") {
    return {
      grantId: candidate.grantId,
      reason: "account_disabled",
      clearsAt: null,
    };
  }
  if (candidate.accountState === "revoked") {
    return {
      grantId: candidate.grantId,
      reason: "account_revoked",
      clearsAt: null,
    };
  }
  if (candidate.accountState === "storage_full" && need.kind === "drive") {
    return {
      grantId: candidate.grantId,
      reason: "account_storage_full",
      clearsAt: null,
    };
  }

  const cooldown = candidate.accountCooldownUntil;
  if (cooldown && cooldown.getTime() > now.getTime()) {
    return {
      grantId: candidate.grantId,
      reason: "account_rate_limited",
      clearsAt: cooldown,
    };
  }

  // ── Project axis ─────────────────────────────────────────────────────────
  if (candidate.projectState === "disabled") {
    return {
      grantId: candidate.grantId,
      reason: "project_disabled",
      clearsAt: null,
    };
  }
  if (candidate.projectState === "invalid") {
    return {
      grantId: candidate.grantId,
      reason: "project_invalid",
      clearsAt: null,
    };
  }

  // ── Capacity for what is actually being asked ────────────────────────────
  if (need.kind === "youtube") {
    const remaining = unitsRemaining(candidate.projectLedger, now);
    if (remaining < YOUTUBE_COST[need.operation]) {
      return {
        grantId: candidate.grantId,
        reason: "project_out_of_units",
        clearsAt: candidate.projectLedger.unitsResetAt,
      };
    }
    // Drive storage is irrelevant to a YouTube upload: the bytes go to
    // YouTube, which does not bill the account's 15 GB.
    return null;
  }

  // A null limit is an unmetered account, not a zero-byte one.
  if (candidate.storageLimitBytes !== null) {
    const used = candidate.storageUsageBytes ?? 0;
    const free = candidate.storageLimitBytes - used;
    if (free < need.bytes) {
      return {
        grantId: candidate.grantId,
        reason: "account_storage_insufficient",
        clearsAt: null,
      };
    }
  }

  return null;
}

/**
 * Preferred order: account first, then project.
 *
 * Account dominates because it is the half the buyer can see — it decides
 * which channel hosts the video and which Drive holds the file. Keeping a
 * seller's main account in use for as long as it has capacity means their
 * videos stay on one channel, whereas ordering by project would scatter them
 * across channels for a reason no seller would ever guess. Projects are
 * interchangeable plumbing, so they only break ties.
 *
 * grantId last, so the choice is stable across identical priorities rather
 * than depending on whatever order the rows came back in.
 */
function byPreference(a: GrantCandidate, b: GrantCandidate): number {
  if (a.accountPriority !== b.accountPriority) {
    return a.accountPriority - b.accountPriority;
  }
  if (a.projectPriority !== b.projectPriority) {
    return a.projectPriority - b.projectPriority;
  }
  return a.grantId < b.grantId ? -1 : a.grantId > b.grantId ? 1 : 0;
}

export function pickGrant(
  candidates: readonly GrantCandidate[],
  need: MediaNeed,
  now: Date,
  alreadyTried: ReadonlySet<string> = new Set(),
): PickResult {
  const ordered = [...candidates].sort(byPreference);
  const rejections: Rejection[] = [];

  for (const candidate of ordered) {
    const rejection = evaluate(candidate, need, now, alreadyTried);
    if (!rejection) return { ok: true, grant: candidate };
    rejections.push(rejection);
  }

  // The soonest moment any blocked candidate frees up. Null means every
  // blocker needs the seller to do something, and the UI should say so rather
  // than promising a retry that will never succeed.
  const waits = rejections
    .filter((r) => clearsOnItsOwn(r.reason) && r.clearsAt !== null)
    .map((r) => (r.clearsAt as Date).getTime());

  return {
    ok: false,
    retryAt: waits.length > 0 ? new Date(Math.min(...waits)) : null,
    rejections,
  };
}

/**
 * Total uploads the pool can still absorb today.
 *
 * Summed per project, not per grant, because grants sharing a project share
 * one budget — counting them separately is exactly the mistake that makes
 * four accounts on one project look like 24 uploads when it is 6.
 */
export function remainingYouTubeUploads(
  candidates: readonly GrantCandidate[],
  now: Date,
): number {
  const usableProjects = new Map<string, QuotaLedger>();

  for (const candidate of candidates) {
    if (candidate.grantState !== "active") continue;
    if (candidate.projectState === "disabled") continue;
    if (candidate.projectState === "invalid") continue;
    if (
      candidate.accountState === "disabled" ||
      candidate.accountState === "revoked"
    ) {
      continue;
    }
    usableProjects.set(candidate.projectId, candidate.projectLedger);
  }

  let total = 0;
  for (const ledger of usableProjects.values()) {
    total += Math.floor(
      unitsRemaining(ledger, now) / YOUTUBE_COST.videosInsert,
    );
  }
  return total;
}
