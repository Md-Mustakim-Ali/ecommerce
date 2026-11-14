/**
 * When to look at a pending asset again.
 *
 * Sized around what is actually being waited for. A YouTube transcode is
 * usually done inside a couple of minutes but can take well over half an hour
 * for a long video shot on a phone, and a Drive upload is effectively instant.
 * So the first few checks are quick — most assets finish there — and the
 * interval then widens rather than hammering a job that is genuinely slow.
 *
 * The whole schedule is pure and clock-injected, because the failure it
 * prevents is invisible: a backoff that is subtly too aggressive costs quota
 * and looks fine, and one that is too slow leaves sellers staring at
 * "uploading" for an hour after the video was ready.
 */

/** Seconds to wait before check N, indexed by attempts already made. */
const BACKOFF_SECONDS = [30, 60, 120, 300, 600, 900] as const;

/** Everything past the table waits this long. */
const MAX_INTERVAL_SECONDS = 900;

/**
 * Give up after this long in flight.
 *
 * Two hours is well past YouTube's worst realistic transcode. Past that the
 * video is not coming, and leaving the row pending forever means the product
 * never publishes and nobody is told why.
 */
export const MAX_SETTLING_MS = 2 * 60 * 60 * 1000;

/** A hard stop independent of elapsed time, for a row stuck in a retry loop. */
export const MAX_CHECK_ATTEMPTS = 40;

export function backoffSeconds(attempts: number): number {
  if (attempts < 0) return BACKOFF_SECONDS[0];
  return BACKOFF_SECONDS[attempts] ?? MAX_INTERVAL_SECONDS;
}

export function nextCheckAt(attempts: number, now: Date): Date {
  return new Date(now.getTime() + backoffSeconds(attempts) * 1000);
}

export type PendingAsset = {
  id: string;
  checkAttempts: number;
  lastCheckedAt: Date | null;
  createdAt: Date;
};

/**
 * Whether enough time has passed to check again.
 *
 * A row that has never been checked is always due — that is the moment right
 * after the seller pressed upload, when they are still looking at the screen.
 */
export function isDueForCheck(asset: PendingAsset, now: Date): boolean {
  if (!asset.lastCheckedAt) return true;
  const due = nextCheckAt(asset.checkAttempts, asset.lastCheckedAt);
  return now.getTime() >= due.getTime();
}

export type GiveUpDecision =
  | { giveUp: false }
  | { giveUp: true; reason: string };

export function shouldGiveUp(asset: PendingAsset, now: Date): GiveUpDecision {
  if (asset.checkAttempts >= MAX_CHECK_ATTEMPTS) {
    return {
      giveUp: true,
      reason: "Gave up after too many checks. Try uploading it again.",
    };
  }

  if (now.getTime() - asset.createdAt.getTime() >= MAX_SETTLING_MS) {
    return {
      giveUp: true,
      reason:
        "This has been processing for over two hours. Try uploading it again.",
    };
  }

  return { giveUp: false };
}

/**
 * How often to re-check media that is already live.
 *
 * The failure this exists for is quiet and late: a seller tidies their Drive
 * or flips a video to private weeks after launch, and a selling product
 * silently grows a broken image. Nothing else in the system would ever notice
 * — the row still says `ready`.
 *
 * A day is a compromise. More often wastes calls on assets that almost never
 * change; less often means a listing can be visibly broken for most of a week.
 */
export const REVERIFY_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function isDueForReverification(
  lastCheckedAt: Date | null,
  now: Date,
): boolean {
  if (!lastCheckedAt) return true;
  return now.getTime() - lastCheckedAt.getTime() >= REVERIFY_INTERVAL_MS;
}
