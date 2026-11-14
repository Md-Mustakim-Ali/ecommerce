import { describe, expect, it } from "vitest";
import {
  backoffSeconds,
  isDueForCheck,
  isDueForReverification,
  MAX_CHECK_ATTEMPTS,
  nextCheckAt,
  type PendingAsset,
  shouldGiveUp,
} from "./schedule";

const now = new Date("2026-01-15T20:00:00Z");

const asset = (overrides: Partial<PendingAsset> = {}): PendingAsset => ({
  id: "m1",
  checkAttempts: 0,
  lastCheckedAt: null,
  createdAt: new Date("2026-01-15T19:59:00Z"),
  ...overrides,
});

describe("backoffSeconds", () => {
  it("checks quickly at first, because most assets finish there", () => {
    expect(backoffSeconds(0)).toBe(30);
    expect(backoffSeconds(1)).toBe(60);
    expect(backoffSeconds(2)).toBe(120);
  });

  it("widens rather than hammering a genuinely slow transcode", () => {
    expect(backoffSeconds(3)).toBe(300);
    expect(backoffSeconds(4)).toBe(600);
    expect(backoffSeconds(5)).toBe(900);
  });

  it("caps instead of growing without limit", () => {
    expect(backoffSeconds(6)).toBe(900);
    expect(backoffSeconds(50)).toBe(900);
  });

  it("treats a negative count as the first check", () => {
    expect(backoffSeconds(-1)).toBe(30);
  });
});

describe("nextCheckAt", () => {
  it("adds the interval to the given moment", () => {
    expect(nextCheckAt(0, now).toISOString()).toBe("2026-01-15T20:00:30.000Z");
    expect(nextCheckAt(3, now).toISOString()).toBe("2026-01-15T20:05:00.000Z");
  });
});

describe("isDueForCheck", () => {
  it("checks a brand-new asset immediately", () => {
    // The moment right after the seller pressed upload, while they are still
    // looking at the screen.
    expect(isDueForCheck(asset(), now)).toBe(true);
  });

  it("waits out the interval", () => {
    const recent = asset({
      checkAttempts: 1,
      lastCheckedAt: new Date("2026-01-15T19:59:30Z"),
    });
    // 30s ago, and one attempt means a 60s wait.
    expect(isDueForCheck(recent, now)).toBe(false);
  });

  it("comes due once the interval has passed", () => {
    const stale = asset({
      checkAttempts: 1,
      lastCheckedAt: new Date("2026-01-15T19:58:00Z"),
    });
    expect(isDueForCheck(stale, now)).toBe(true);
  });

  it("is due exactly on the boundary", () => {
    const boundary = asset({
      checkAttempts: 0,
      lastCheckedAt: new Date("2026-01-15T19:59:30Z"),
    });
    expect(isDueForCheck(boundary, now)).toBe(true);
  });
});

describe("shouldGiveUp", () => {
  it("keeps waiting for a recent asset", () => {
    expect(shouldGiveUp(asset(), now).giveUp).toBe(false);
  });

  it("gives up after two hours in flight", () => {
    // Well past YouTube's worst realistic transcode. Leaving it pending
    // forever means the product never publishes and nobody is told why.
    const old = asset({ createdAt: new Date("2026-01-15T17:30:00Z") });
    const decision = shouldGiveUp(old, now);
    expect(decision.giveUp).toBe(true);
    if (decision.giveUp) expect(decision.reason).toMatch(/two hours/);
  });

  it("gives up after too many attempts even if recent", () => {
    const looping = asset({ checkAttempts: MAX_CHECK_ATTEMPTS });
    const decision = shouldGiveUp(looping, now);
    expect(decision.giveUp).toBe(true);
    if (decision.giveUp) expect(decision.reason).toMatch(/too many checks/);
  });

  it("does not give up one attempt early", () => {
    expect(
      shouldGiveUp(asset({ checkAttempts: MAX_CHECK_ATTEMPTS - 1 }), now)
        .giveUp,
    ).toBe(false);
  });
});

describe("isDueForReverification", () => {
  it("verifies media that has never been checked", () => {
    expect(isDueForReverification(null, now)).toBe(true);
  });

  it("leaves recently checked media alone", () => {
    expect(isDueForReverification(new Date("2026-01-15T08:00:00Z"), now)).toBe(
      false,
    );
  });

  it("comes due after a day", () => {
    // Catches the seller who tidies their Drive weeks after launch and
    // silently breaks a selling product.
    expect(isDueForReverification(new Date("2026-01-14T19:00:00Z"), now)).toBe(
      true,
    );
  });
});
