/**
 * YouTube Data API quota arithmetic.
 *
 * Two facts drive everything here. Quota is charged to the Cloud project that
 * owns the OAuth client rather than to the account whose token authorised the
 * call, and an upload costs 1,600 of a default 10,000 units a day. Six uploads
 * a day per project is a tight enough budget that guessing is not good enough:
 * the picker has to know what a call will cost before making it, or it finds
 * the ceiling by spending 1,600 units on a 403.
 */

/**
 * Documented unit costs. Read costs are rounding error next to `insert`, which
 * is the entire reason the readiness poller can check as often as it likes.
 */
export const YOUTUBE_COST = {
  /** The expensive one. Charged even when the upload later fails to process. */
  videosInsert: 1600,
  videosList: 1,
  videosUpdate: 50,
  videosDelete: 50,
  channelsList: 1,
  playlistItemsList: 1,
} as const;

export type YouTubeOperation = keyof typeof YOUTUBE_COST;

/** Google's default allocation for a new project. */
export const DEFAULT_DAILY_UNIT_LIMIT = 10_000;

/**
 * Google resets quota at midnight Pacific, not UTC and not local.
 *
 * Hardcoding UTC-8 would be wrong for eight months of the year, and being
 * wrong here means either believing the budget refilled when it has not (every
 * upload 403s for an hour) or holding uploads back an hour after it did.
 */
const QUOTA_TIMEZONE = "America/Los_Angeles";

/**
 * How far `tz` is behind UTC at `at`, in milliseconds.
 *
 * Positive for zones west of Greenwich. There is no direct API for this, so it
 * is derived by formatting the instant in the zone and reading the wall clock
 * back as though it were UTC.
 */
function zoneOffsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const field = (type: string): number => {
    const found = parts.find((part) => part.type === type);
    if (!found) throw new Error(`Missing ${type} in formatted date`);
    return Number(found.value);
  };

  // hour24 % 24: some ICU versions render midnight as "24" rather than "00".
  const wallAsUtc = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    field("hour") % 24,
    field("minute"),
    field("second"),
  );

  return at.getTime() - wallAsUtc;
}

/**
 * The next instant at which a project's units go back to zero.
 *
 * Exactly midnight Pacific counts as already reset — the boundary belongs to
 * the new day, so a poller firing on the tick does not wait another 24 hours.
 */
export function nextQuotaResetAt(now: Date): Date {
  const offset = zoneOffsetMs(now, QUOTA_TIMEZONE);

  // `now` as Pacific wall time, then the midnight that starts the next day.
  const wall = new Date(now.getTime() - offset);
  const nextMidnightWall = Date.UTC(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate() + 1,
  );

  // The offset at the target instant can differ from the offset now — that is
  // exactly what happens on the two DST changeover nights, and re-measuring
  // there is the difference between resetting at 07:00 and 08:00 UTC.
  const firstGuess = nextMidnightWall + offset;
  const settledOffset = zoneOffsetMs(new Date(firstGuess), QUOTA_TIMEZONE);
  return new Date(nextMidnightWall + settledOffset);
}

export type QuotaLedger = {
  unitsUsed: number;
  dailyUnitLimit: number;
  unitsResetAt: Date;
};

/**
 * Units still available, accounting for a reset that has fallen due but has
 * not been written back yet.
 *
 * The sweeper is what normally clears the counter, and on a free instance that
 * sleeps it may not have run for hours. Treating a stale row as exhausted
 * would idle every project until something happened to wake the sweeper.
 */
export function unitsRemaining(ledger: QuotaLedger, now: Date): number {
  if (now.getTime() >= ledger.unitsResetAt.getTime()) {
    return ledger.dailyUnitLimit;
  }
  return Math.max(0, ledger.dailyUnitLimit - ledger.unitsUsed);
}

export function canAfford(
  ledger: QuotaLedger,
  operation: YouTubeOperation,
  now: Date,
): boolean {
  return unitsRemaining(ledger, now) >= YOUTUBE_COST[operation];
}

/**
 * How many uploads a budget is worth. Used in the seller UI, where "6 videos
 * left today" is the only form of this anyone actually wants to read.
 */
export function uploadsRemaining(ledger: QuotaLedger, now: Date): number {
  return Math.floor(unitsRemaining(ledger, now) / YOUTUBE_COST.videosInsert);
}

/**
 * The ledger after spending, rolling the window over first if it has lapsed.
 *
 * Pure so the caller decides how to persist it. Spend is recorded before the
 * API call, never after: over-counting costs a few hours of capacity, while
 * under-counting means discovering the ceiling by burning 1,600 units on a
 * call that was always going to be refused.
 */
export function spendUnits(
  ledger: QuotaLedger,
  operation: YouTubeOperation,
  now: Date,
): QuotaLedger {
  const lapsed = now.getTime() >= ledger.unitsResetAt.getTime();
  const base = lapsed ? 0 : ledger.unitsUsed;

  return {
    dailyUnitLimit: ledger.dailyUnitLimit,
    unitsUsed: base + YOUTUBE_COST[operation],
    unitsResetAt: lapsed ? nextQuotaResetAt(now) : ledger.unitsResetAt,
  };
}
