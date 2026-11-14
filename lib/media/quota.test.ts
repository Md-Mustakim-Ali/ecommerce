import { describe, expect, it } from "vitest";
import {
  canAfford,
  nextQuotaResetAt,
  type QuotaLedger,
  spendUnits,
  unitsRemaining,
  uploadsRemaining,
  YOUTUBE_COST,
} from "./quota";

const ledger = (
  used: number,
  resetAt: string,
  limit = 10_000,
): QuotaLedger => ({
  unitsUsed: used,
  dailyUnitLimit: limit,
  unitsResetAt: new Date(resetAt),
});

describe("nextQuotaResetAt", () => {
  it("resets at 08:00 UTC while Pacific is on standard time", () => {
    // 2026-01-15 12:00 Pacific.
    const now = new Date("2026-01-15T20:00:00Z");
    expect(nextQuotaResetAt(now).toISOString()).toBe(
      "2026-01-16T08:00:00.000Z",
    );
  });

  it("resets at 07:00 UTC while Pacific is on daylight time", () => {
    // 2026-07-15 12:00 Pacific.
    const now = new Date("2026-07-15T19:00:00Z");
    expect(nextQuotaResetAt(now).toISOString()).toBe(
      "2026-07-16T07:00:00.000Z",
    );
  });

  it("treats midnight Pacific as belonging to the new day", () => {
    // Exactly the reset instant. A poller firing on the tick must be given the
    // NEXT boundary, not told to wait another full day.
    const now = new Date("2026-01-16T08:00:00Z");
    expect(nextQuotaResetAt(now).toISOString()).toBe(
      "2026-01-17T08:00:00.000Z",
    );
  });

  it("crosses the spring-forward boundary", () => {
    // DST starts 2026-03-08 02:00. Midnight on the 8th is still PST (08:00Z),
    // and the following midnight is PDT (07:00Z). A hardcoded -8 gets the
    // second one wrong by an hour.
    expect(
      nextQuotaResetAt(new Date("2026-03-07T20:00:00Z")).toISOString(),
    ).toBe("2026-03-08T08:00:00.000Z");
    expect(
      nextQuotaResetAt(new Date("2026-03-08T20:00:00Z")).toISOString(),
    ).toBe("2026-03-09T07:00:00.000Z");
  });

  it("crosses the fall-back boundary", () => {
    // DST ends 2026-11-01 02:00.
    expect(
      nextQuotaResetAt(new Date("2026-10-31T19:00:00Z")).toISOString(),
    ).toBe("2026-11-01T07:00:00.000Z");
    expect(
      nextQuotaResetAt(new Date("2026-11-01T19:00:00Z")).toISOString(),
    ).toBe("2026-11-02T08:00:00.000Z");
  });
});

describe("unitsRemaining", () => {
  const now = new Date("2026-01-15T20:00:00Z");

  it("subtracts what has been spent", () => {
    expect(unitsRemaining(ledger(1600, "2026-01-16T08:00:00Z"), now)).toBe(
      8400,
    );
  });

  it("never goes negative", () => {
    expect(unitsRemaining(ledger(11_000, "2026-01-16T08:00:00Z"), now)).toBe(0);
  });

  it("treats a lapsed window as refilled without waiting for a writeback", () => {
    // The sweeper may not have run for hours on an instance that sleeps.
    // Trusting the stale counter would idle the project long after Google
    // had already forgiven it.
    const stale = ledger(10_000, "2026-01-15T08:00:00Z");
    expect(unitsRemaining(stale, now)).toBe(10_000);
  });

  it("honours a raised limit from an approved audit", () => {
    expect(
      unitsRemaining(ledger(10_000, "2026-01-16T08:00:00Z", 500_000), now),
    ).toBe(490_000);
  });
});

describe("uploadsRemaining", () => {
  const now = new Date("2026-01-15T20:00:00Z");

  it("is six on a fresh default project", () => {
    expect(uploadsRemaining(ledger(0, "2026-01-16T08:00:00Z"), now)).toBe(6);
  });

  it("rounds down — a partial upload is not an upload", () => {
    // 10,000 - 8,000 = 2,000 remaining, which buys one 1,600-unit insert.
    expect(uploadsRemaining(ledger(8000, "2026-01-16T08:00:00Z"), now)).toBe(1);
    expect(uploadsRemaining(ledger(8500, "2026-01-16T08:00:00Z"), now)).toBe(0);
  });
});

describe("canAfford", () => {
  const now = new Date("2026-01-15T20:00:00Z");

  it("separates a cheap read from an expensive insert", () => {
    const nearlySpent = ledger(9600, "2026-01-16T08:00:00Z");
    expect(canAfford(nearlySpent, "videosList", now)).toBe(true);
    expect(canAfford(nearlySpent, "videosInsert", now)).toBe(false);
  });

  it("allows an insert with exactly enough left", () => {
    const exact = ledger(
      10_000 - YOUTUBE_COST.videosInsert,
      "2026-01-16T08:00:00Z",
    );
    expect(canAfford(exact, "videosInsert", now)).toBe(true);
  });
});

describe("spendUnits", () => {
  const now = new Date("2026-01-15T20:00:00Z");

  it("adds the cost within an open window", () => {
    const after = spendUnits(
      ledger(1600, "2026-01-16T08:00:00Z"),
      "videosInsert",
      now,
    );
    expect(after.unitsUsed).toBe(3200);
    expect(after.unitsResetAt.toISOString()).toBe("2026-01-16T08:00:00.000Z");
  });

  it("rolls the window over before charging a lapsed ledger", () => {
    const after = spendUnits(
      ledger(10_000, "2026-01-15T08:00:00Z"),
      "videosInsert",
      now,
    );
    expect(after.unitsUsed).toBe(1600);
    expect(after.unitsResetAt.toISOString()).toBe("2026-01-16T08:00:00.000Z");
  });
});
