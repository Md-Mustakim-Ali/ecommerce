import { beforeEach, describe, expect, it } from "vitest";
import { type FailoverSink, GoogleApiError, runWithFailover } from "./failover";
import type { GrantCandidate } from "./picker";

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

type Call = { kind: string; id: string; detail?: string };

function recordingSink() {
  const calls: Call[] = [];
  const sink: FailoverSink = {
    async markProject({ projectId, state }) {
      calls.push({ kind: "project", id: projectId, detail: state });
    },
    async markAccount({ accountId, state }) {
      calls.push({ kind: "account", id: accountId, detail: state });
    },
    async markGrant({ grantId }) {
      calls.push({ kind: "grant", id: grantId, detail: "invalid" });
    },
    async spendUnits({ projectId, operation }) {
      calls.push({ kind: "spend", id: projectId, detail: operation });
    },
    async markGrantUsed({ grantId }) {
      calls.push({ kind: "used", id: grantId });
    },
  };
  return { sink, calls };
}

const youtube = { kind: "youtube", operation: "videosInsert" } as const;
const drive = (bytes: number) => ({ kind: "drive", bytes }) as const;

const fail = (status: number, reason: string) =>
  new GoogleApiError({ status, reason, message: reason });

let recorder: ReturnType<typeof recordingSink>;
beforeEach(() => {
  recorder = recordingSink();
});

describe("runWithFailover — success", () => {
  it("returns the value and records the grant as used", async () => {
    const result = await runWithFailover({
      candidates: [grant()],
      need: youtube,
      now,
      sink: recorder.sink,
      attempt: async () => "video-123",
    });

    expect(result).toMatchObject({ ok: true, value: "video-123" });
    expect(recorder.calls).toContainEqual({ kind: "used", id: "g1" });
  });

  it("charges quota before the call, not after", async () => {
    // If the process dies mid-upload, over-counting costs a few hours of
    // capacity. Under-counting means the next attempt spends 1,600 units
    // discovering a ceiling it could have known about.
    await runWithFailover({
      candidates: [grant()],
      need: youtube,
      now,
      sink: recorder.sink,
      attempt: async () => {
        expect(recorder.calls[0]).toEqual({
          kind: "spend",
          id: "p1",
          detail: "videosInsert",
        });
        return "ok";
      },
    });
  });

  it("does not charge YouTube quota for a Drive upload", async () => {
    await runWithFailover({
      candidates: [grant()],
      need: drive(10 * 1024 * 1024),
      now,
      sink: recorder.sink,
      attempt: async () => "file-1",
    });
    expect(recorder.calls.some((c) => c.kind === "spend")).toBe(false);
  });
});

describe("runWithFailover — the project axis", () => {
  it("skips every other grant on a project that reported quotaExceeded", async () => {
    // The whole point of the design. Four accounts authorised through one
    // project share one budget, so when it is gone all four fail identically.
    // Retrying them would spend 1,600 units per attempt reproducing it.
    const candidates = ["a1", "a2", "a3", "a4"].map((accountId, i) =>
      grant({ grantId: `g${i}`, projectId: "shared", accountId }),
    );

    const attempted: string[] = [];
    const result = await runWithFailover({
      candidates,
      need: youtube,
      now,
      sink: recorder.sink,
      attempt: async (g) => {
        attempted.push(g.grantId);
        throw fail(403, "quotaExceeded");
      },
    });

    expect(attempted).toEqual(["g0"]);
    expect(result).toMatchObject({ ok: false, reason: "no_capacity" });
    if (!result.ok && result.reason === "no_capacity") {
      expect(result.retryAt?.toISOString()).toBe("2026-01-16T08:00:00.000Z");
    }
  });

  it("moves to a different project and succeeds", async () => {
    const candidates = [
      grant({ grantId: "spent", projectId: "p1", accountPriority: 0 }),
      grant({
        grantId: "fresh",
        projectId: "p2",
        accountId: "a2",
        accountPriority: 1,
      }),
    ];

    const attempted: string[] = [];
    const result = await runWithFailover({
      candidates,
      need: youtube,
      now,
      sink: recorder.sink,
      attempt: async (g) => {
        attempted.push(g.grantId);
        if (g.projectId === "p1") throw fail(403, "quotaExceeded");
        return "video-456";
      },
    });

    expect(attempted).toEqual(["spent", "fresh"]);
    expect(result).toMatchObject({ ok: true, value: "video-456" });
    expect(recorder.calls).toContainEqual({
      kind: "project",
      id: "p1",
      detail: "quota_exhausted",
    });
  });

  it("disables a project whose credentials are rejected", async () => {
    const result = await runWithFailover({
      candidates: [grant()],
      need: youtube,
      now,
      sink: recorder.sink,
      attempt: async () => {
        throw fail(401, "invalid_client");
      },
    });

    expect(recorder.calls).toContainEqual({
      kind: "project",
      id: "p1",
      detail: "invalid",
    });
    expect(result.ok).toBe(false);
  });
});

describe("runWithFailover — the account axis", () => {
  it("switches account when Drive is full, keeping the project", async () => {
    const candidates = [
      grant({ grantId: "full", accountId: "a1", accountPriority: 0 }),
      grant({ grantId: "roomy", accountId: "a2", accountPriority: 1 }),
    ];

    const result = await runWithFailover({
      candidates,
      need: drive(1 * GB),
      now,
      sink: recorder.sink,
      attempt: async (g) => {
        if (g.accountId === "a1") throw fail(403, "storageQuotaExceeded");
        return "file-2";
      },
    });

    expect(result).toMatchObject({ ok: true, value: "file-2" });
    expect(recorder.calls).toContainEqual({
      kind: "account",
      id: "a1",
      detail: "storage_full",
    });
  });

  it("skips every grant belonging to a full account", async () => {
    // Two projects, one account. Both grants point at the same full Drive.
    const candidates = [
      grant({ grantId: "g1", projectId: "p1", accountId: "shared" }),
      grant({ grantId: "g2", projectId: "p2", accountId: "shared" }),
    ];

    const attempted: string[] = [];
    await runWithFailover({
      candidates,
      need: drive(1 * GB),
      now,
      sink: recorder.sink,
      attempt: async (g) => {
        attempted.push(g.grantId);
        throw fail(403, "storageQuotaExceeded");
      },
    });

    expect(attempted).toEqual(["g1"]);
  });

  it("cools an account down and uses the next one", async () => {
    const candidates = [
      grant({ grantId: "hot", accountId: "a1", accountPriority: 0 }),
      grant({ grantId: "cool", accountId: "a2", accountPriority: 1 }),
    ];

    const result = await runWithFailover({
      candidates,
      need: youtube,
      now,
      sink: recorder.sink,
      attempt: async (g) => {
        if (g.accountId === "a1") throw fail(403, "userRateLimitExceeded");
        return "video-789";
      },
    });

    expect(result).toMatchObject({ ok: true });
    expect(recorder.calls).toContainEqual({
      kind: "account",
      id: "a1",
      detail: "rate_limited",
    });
  });
});

describe("runWithFailover — the grant axis", () => {
  it("kills only the pair on invalid_grant and keeps the account", async () => {
    // The same account through a different project holds a different token,
    // which is very likely still good.
    // Priorities set explicitly: the tiebreak is by grantId, and "alive"
    // sorts before "dead", so leaving them equal would try them backwards.
    const candidates = [
      grant({
        grantId: "dead",
        projectId: "p1",
        accountId: "shared",
        projectPriority: 0,
      }),
      grant({
        grantId: "alive",
        projectId: "p2",
        accountId: "shared",
        projectPriority: 1,
      }),
    ];

    const attempted: string[] = [];
    const result = await runWithFailover({
      candidates,
      need: youtube,
      now,
      sink: recorder.sink,
      attempt: async (g) => {
        attempted.push(g.grantId);
        if (g.grantId === "dead") throw fail(400, "invalid_grant");
        return "video-abc";
      },
    });

    expect(attempted).toEqual(["dead", "alive"]);
    expect(result).toMatchObject({ ok: true, value: "video-abc" });
    expect(recorder.calls).toContainEqual({
      kind: "grant",
      id: "dead",
      detail: "invalid",
    });
    // The account itself was never blamed.
    expect(recorder.calls.some((c) => c.kind === "account")).toBe(false);
  });
});

describe("runWithFailover — when it should stop", () => {
  it("does not cycle the pool on a transient backend error", async () => {
    const attempted: string[] = [];
    const result = await runWithFailover({
      candidates: [
        grant({ grantId: "g1", accountPriority: 0 }),
        grant({ grantId: "g2", accountId: "a2", accountPriority: 1 }),
      ],
      need: youtube,
      now,
      sink: recorder.sink,
      attempt: async (g) => {
        attempted.push(g.grantId);
        throw fail(503, "backendError");
      },
    });

    expect(attempted).toEqual(["g1"]);
    expect(result).toMatchObject({ ok: false, reason: "transient" });
  });

  it("does not cycle the pool on a rejected file", async () => {
    // An unsupported container fails identically everywhere. Marching through
    // the pool would burn 1,600 units per account to learn nothing.
    const attempted: string[] = [];
    const result = await runWithFailover({
      candidates: [
        grant({ grantId: "g1", accountPriority: 0 }),
        grant({ grantId: "g2", accountId: "a2", accountPriority: 1 }),
      ],
      need: youtube,
      now,
      sink: recorder.sink,
      attempt: async (g) => {
        attempted.push(g.grantId);
        throw fail(400, "badRequest");
      },
    });

    expect(attempted).toEqual(["g1"]);
    expect(result).toMatchObject({ ok: false, reason: "rejected" });
  });

  it("treats a thrown network error as transient rather than fatal", async () => {
    const result = await runWithFailover({
      candidates: [grant()],
      need: youtube,
      now,
      sink: recorder.sink,
      attempt: async () => {
        throw new TypeError("fetch failed");
      },
    });

    expect(result).toMatchObject({ ok: false, reason: "transient" });
    if (!result.ok && result.reason === "transient") {
      expect(result.retryAt.toISOString()).toBe("2026-01-15T20:00:15.000Z");
    }
  });

  it("reports no capacity when nothing is connected", async () => {
    const result = await runWithFailover({
      candidates: [],
      need: youtube,
      now,
      sink: recorder.sink,
      attempt: async () => "unreachable",
    });
    expect(result).toMatchObject({ ok: false, reason: "no_capacity" });
  });

  it("stops at the attempt ceiling instead of looping forever", async () => {
    const candidates = Array.from({ length: 10 }, (_, i) =>
      grant({
        grantId: `g${i}`,
        projectId: `p${i}`,
        accountId: `a${i}`,
        accountPriority: i,
      }),
    );

    const result = await runWithFailover({
      candidates,
      need: youtube,
      now,
      sink: recorder.sink,
      maxAttempts: 3,
      attempt: async () => {
        throw fail(403, "quotaExceeded");
      },
    });

    expect(result).toMatchObject({ ok: false, reason: "exhausted_attempts" });
  });

  it("leaves the caller's candidate array untouched", async () => {
    // A caller uploading several assets reuses the list. Mutating it here
    // would silently degrade every later upload in the batch.
    const candidates = [grant({ grantId: "g1" })];
    await runWithFailover({
      candidates,
      need: youtube,
      now,
      sink: recorder.sink,
      attempt: async () => {
        throw fail(403, "quotaExceeded");
      },
    });
    expect(candidates[0].projectState).toBe("active");
  });
});
