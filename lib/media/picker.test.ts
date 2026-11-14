import { describe, expect, it } from "vitest";
import {
  type GrantCandidate,
  pickGrant,
  remainingYouTubeUploads,
} from "./picker";

const now = new Date("2026-01-15T20:00:00Z");
const nextReset = new Date("2026-01-16T08:00:00Z");

const GB = 1024 * 1024 * 1024;

function grant(overrides: Partial<GrantCandidate> = {}): GrantCandidate {
  return {
    grantId: "g1",
    projectId: "p1",
    accountId: "a1",
    grantState: "active",

    projectState: "active",
    projectPriority: 0,
    projectLedger: {
      unitsUsed: 0,
      dailyUnitLimit: 10_000,
      unitsResetAt: nextReset,
    },

    accountState: "active",
    accountPriority: 0,
    accountCooldownUntil: null,
    storageLimitBytes: 15 * GB,
    storageUsageBytes: 1 * GB,
    ...overrides,
  };
}

const youtubeUpload = { kind: "youtube", operation: "videosInsert" } as const;
const driveUpload = (bytes: number) => ({ kind: "drive", bytes }) as const;

describe("pickGrant — ordering", () => {
  it("prefers the lowest account priority", () => {
    const result = pickGrant(
      [
        grant({ grantId: "second", accountId: "a2", accountPriority: 1 }),
        grant({ grantId: "first", accountId: "a1", accountPriority: 0 }),
      ],
      youtubeUpload,
      now,
    );
    expect(result.ok && result.grant.grantId).toBe("first");
  });

  it("lets the account outrank the project", () => {
    // The account decides which channel the buyer sees the video on, so a
    // seller's main account stays in use even when it is paired with their
    // lower-priority project.
    const result = pickGrant(
      [
        grant({
          grantId: "good-project-wrong-account",
          accountPriority: 5,
          projectPriority: 0,
        }),
        grant({
          grantId: "main-account",
          accountPriority: 0,
          projectPriority: 9,
        }),
      ],
      youtubeUpload,
      now,
    );
    expect(result.ok && result.grant.grantId).toBe("main-account");
  });

  it("is stable when priorities tie", () => {
    const candidates = [grant({ grantId: "bbb" }), grant({ grantId: "aaa" })];
    expect(pickGrant(candidates, youtubeUpload, now).ok).toBe(true);
    expect(
      pickGrant(candidates, youtubeUpload, now).ok &&
        pickGrant([...candidates].reverse(), youtubeUpload, now).ok,
    ).toBe(true);
    const forward = pickGrant(candidates, youtubeUpload, now);
    const reversed = pickGrant([...candidates].reverse(), youtubeUpload, now);
    expect(forward.ok && forward.grant.grantId).toBe(
      reversed.ok ? reversed.grant.grantId : null,
    );
  });
});

describe("pickGrant — the project axis", () => {
  it("skips a project with no units left and takes another", () => {
    const result = pickGrant(
      [
        grant({
          grantId: "spent",
          accountPriority: 0,
          projectLedger: {
            unitsUsed: 10_000,
            dailyUnitLimit: 10_000,
            unitsResetAt: nextReset,
          },
        }),
        grant({
          grantId: "fresh",
          projectId: "p2",
          accountPriority: 1,
        }),
      ],
      youtubeUpload,
      now,
    );
    expect(result.ok && result.grant.grantId).toBe("fresh");
  });

  it("treats a stale quota_exhausted flag as healed once the reset passes", () => {
    // The sweeper writes the flag back; on an instance that sleeps it may not
    // have run. Believing the stale flag would idle the pool for hours after
    // Google had already refilled it.
    const result = pickGrant(
      [
        grant({
          projectState: "quota_exhausted",
          projectLedger: {
            unitsUsed: 10_000,
            dailyUnitLimit: 10_000,
            unitsResetAt: new Date("2026-01-15T08:00:00Z"),
          },
        }),
      ],
      youtubeUpload,
      now,
    );
    expect(result.ok).toBe(true);
  });

  it("never auto-selects a disabled or invalid project", () => {
    for (const projectState of ["disabled", "invalid"] as const) {
      const result = pickGrant([grant({ projectState })], youtubeUpload, now);
      expect(result.ok).toBe(false);
      // Neither clears with time — the seller has to act.
      expect(!result.ok && result.retryAt).toBeNull();
    }
  });
});

describe("pickGrant — the account axis", () => {
  it("skips a full Drive for a Drive upload", () => {
    const result = pickGrant(
      [
        grant({ grantId: "full", accountState: "storage_full" }),
        grant({ grantId: "roomy", accountId: "a2", accountPriority: 1 }),
      ],
      driveUpload(100 * 1024 * 1024),
      now,
    );
    expect(result.ok && result.grant.grantId).toBe("roomy");
  });

  it("still uses a full Drive for a YouTube upload", () => {
    // The video bytes go to YouTube, which does not bill the account's 15 GB.
    // Skipping this account would throw away capacity for no reason.
    const result = pickGrant(
      [grant({ grantId: "full", accountState: "storage_full" })],
      youtubeUpload,
      now,
    );
    expect(result.ok && result.grant.grantId).toBe("full");
  });

  it("rejects an account without room for this particular file", () => {
    const result = pickGrant(
      [grant({ storageLimitBytes: 15 * GB, storageUsageBytes: 14 * GB })],
      driveUpload(2 * GB),
      now,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.rejections[0].reason).toBe(
      "account_storage_insufficient",
    );
  });

  it("treats a null storage limit as unmetered, not as zero", () => {
    const result = pickGrant(
      [grant({ storageLimitBytes: null, storageUsageBytes: null })],
      driveUpload(500 * GB),
      now,
    );
    expect(result.ok).toBe(true);
  });

  it("honours a live cooldown and releases an expired one", () => {
    const live = pickGrant(
      [grant({ accountCooldownUntil: new Date("2026-01-15T20:05:00Z") })],
      youtubeUpload,
      now,
    );
    expect(live.ok).toBe(false);
    expect(!live.ok && live.retryAt?.toISOString()).toBe(
      "2026-01-15T20:05:00.000Z",
    );

    const expired = pickGrant(
      [
        grant({
          accountState: "rate_limited",
          accountCooldownUntil: new Date("2026-01-15T19:55:00Z"),
        }),
      ],
      youtubeUpload,
      now,
    );
    expect(expired.ok).toBe(true);
  });

  it("never selects a revoked or disabled account", () => {
    for (const accountState of ["revoked", "disabled"] as const) {
      expect(pickGrant([grant({ accountState })], youtubeUpload, now).ok).toBe(
        false,
      );
    }
  });
});

describe("pickGrant — failover loop support", () => {
  it("excludes grants already attempted", () => {
    const candidates = [
      grant({ grantId: "first", accountPriority: 0 }),
      grant({ grantId: "second", accountId: "a2", accountPriority: 1 }),
    ];
    const result = pickGrant(
      candidates,
      youtubeUpload,
      now,
      new Set(["first"]),
    );
    expect(result.ok && result.grant.grantId).toBe("second");
  });

  it("reports the soonest self-clearing blocker as retryAt", () => {
    const result = pickGrant(
      [
        grant({
          grantId: "cooling",
          accountCooldownUntil: new Date("2026-01-15T23:00:00Z"),
        }),
        grant({
          grantId: "spent",
          accountId: "a2",
          projectLedger: {
            unitsUsed: 10_000,
            dailyUnitLimit: 10_000,
            unitsResetAt: nextReset,
          },
        }),
      ],
      youtubeUpload,
      now,
    );
    expect(result.ok).toBe(false);
    // 23:00 beats the 08:00-next-day quota reset.
    expect(!result.ok && result.retryAt?.toISOString()).toBe(
      "2026-01-15T23:00:00.000Z",
    );
  });

  it("reports no retryAt when every blocker needs the seller", () => {
    const result = pickGrant(
      [
        grant({ grantId: "a", grantState: "invalid" }),
        grant({ grantId: "b", accountId: "a2", accountState: "revoked" }),
      ],
      youtubeUpload,
      now,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.retryAt).toBeNull();
  });

  it("reports nothing connected as an empty rejection list", () => {
    const result = pickGrant([], youtubeUpload, now);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.rejections).toEqual([]);
    expect(!result.ok && result.retryAt).toBeNull();
  });
});

describe("remainingYouTubeUploads", () => {
  it("counts one budget per project, not per grant", () => {
    // Four accounts authorised through ONE project is still six uploads. This
    // is the arithmetic sellers get wrong, and counting per grant would
    // promise 24.
    const shared = ["a1", "a2", "a3", "a4"].map((accountId, index) =>
      grant({ grantId: `g${index}`, projectId: "p1", accountId }),
    );
    expect(remainingYouTubeUploads(shared, now)).toBe(6);
  });

  it("adds up genuinely separate projects", () => {
    const spread = ["p1", "p2", "p3"].map((projectId, index) =>
      grant({ grantId: `g${index}`, projectId, accountId: `a${index}` }),
    );
    expect(remainingYouTubeUploads(spread, now)).toBe(18);
  });

  it("ignores projects and accounts that cannot be used", () => {
    expect(
      remainingYouTubeUploads(
        [
          grant({ grantId: "g1", projectId: "p1", projectState: "disabled" }),
          grant({ grantId: "g2", projectId: "p2", accountState: "revoked" }),
          grant({ grantId: "g3", projectId: "p3", grantState: "invalid" }),
          grant({ grantId: "g4", projectId: "p4" }),
        ],
        now,
      ),
    ).toBe(6);
  });

  it("counts a lapsed window as refilled", () => {
    expect(
      remainingYouTubeUploads(
        [
          grant({
            projectLedger: {
              unitsUsed: 10_000,
              dailyUnitLimit: 10_000,
              unitsResetAt: new Date("2026-01-15T08:00:00Z"),
            },
          }),
        ],
        now,
      ),
    ).toBe(6);
  });
});
