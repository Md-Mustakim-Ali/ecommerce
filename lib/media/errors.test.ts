import { describe, expect, it } from "vitest";
import {
  classifyGoogleFailure,
  parseGoogleFailure,
  shouldTryAnotherGrant,
} from "./errors";

const now = new Date("2026-01-15T20:00:00Z");
const headers = (values: Record<string, string>) => ({
  get: (name: string) => values[name.toLowerCase()] ?? null,
});

describe("parseGoogleFailure", () => {
  it("reads the classic Drive/YouTube envelope", () => {
    const parsed = parseGoogleFailure(403, {
      error: {
        code: 403,
        message: "The request cannot be completed.",
        errors: [
          {
            domain: "youtube.quota",
            reason: "quotaExceeded",
            message:
              "The request cannot be completed because you have exceeded your quota.",
          },
        ],
      },
    });
    expect(parsed.reason).toBe("quotaExceeded");
    expect(parsed.status).toBe(403);
  });

  it("reads the flat OAuth token-endpoint envelope", () => {
    const parsed = parseGoogleFailure(400, {
      error: "invalid_grant",
      error_description: "Token has been expired or revoked.",
    });
    expect(parsed.reason).toBe("invalid_grant");
    expect(parsed.message).toBe("Token has been expired or revoked.");
  });

  it("falls back to the gRPC-style status when there is no errors array", () => {
    const parsed = parseGoogleFailure(429, {
      error: {
        code: 429,
        message: "Quota exceeded.",
        status: "RESOURCE_EXHAUSTED",
      },
    });
    expect(parsed.reason).toBe("RESOURCE_EXHAUSTED");
  });

  it("picks up Retry-After", () => {
    const parsed = parseGoogleFailure(
      429,
      {},
      headers({ "retry-after": "120" }),
    );
    expect(parsed.retryAfterSeconds).toBe(120);
  });

  it("ignores an unparseable Retry-After rather than producing NaN", () => {
    // A NaN here propagates into a cooldown Date of Invalid Date, which
    // compares false against everything and silently disables the cooldown.
    const parsed = parseGoogleFailure(
      429,
      {},
      headers({ "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }),
    );
    expect(parsed.retryAfterSeconds).toBeUndefined();
  });

  it("survives a non-JSON body", () => {
    expect(parseGoogleFailure(502, "<html>Bad Gateway</html>").status).toBe(
      502,
    );
    expect(parseGoogleFailure(502, null).reason).toBeUndefined();
  });
});

describe("classifyGoogleFailure — the four look-alike 403s", () => {
  it("blames the project for quotaExceeded", () => {
    const action = classifyGoogleFailure(
      { status: 403, reason: "quotaExceeded" },
      now,
    );
    expect(action.action).toBe("exhaust_project");
    if (action.action === "exhaust_project") {
      expect(action.retryAfter.toISOString()).toBe("2026-01-16T08:00:00.000Z");
    }
  });

  it("blames the account for storageQuotaExceeded", () => {
    expect(
      classifyGoogleFailure(
        { status: 403, reason: "storageQuotaExceeded" },
        now,
      ).action,
    ).toBe("fill_account");
  });

  it("cools the account until the daily reset for uploadLimitExceeded", () => {
    // A per-channel daily cap, not an ordinary throttle. A 60-second cooldown
    // here would retry all day and never succeed.
    const action = classifyGoogleFailure(
      { status: 403, reason: "uploadLimitExceeded" },
      now,
    );
    expect(action.action).toBe("cooldown_account");
    if (action.action === "cooldown_account") {
      expect(action.until.toISOString()).toBe("2026-01-16T08:00:00.000Z");
    }
  });

  it("blames only the pair for invalid_grant", () => {
    // The same account authorised through a different project holds a
    // different token that is very likely still good.
    expect(
      classifyGoogleFailure({ status: 400, reason: "invalid_grant" }, now)
        .action,
    ).toBe("invalidate_grant");
  });
});

describe("classifyGoogleFailure — remaining reasons", () => {
  it("disables a project whose credentials are wrong", () => {
    for (const reason of [
      "invalid_client",
      "accessNotConfigured",
      "SERVICE_DISABLED",
    ]) {
      expect(classifyGoogleFailure({ status: 403, reason }, now).action).toBe(
        "disable_project",
      );
    }
  });

  it("gives a rate-limited account a short cooldown", () => {
    const action = classifyGoogleFailure(
      { status: 403, reason: "userRateLimitExceeded" },
      now,
    );
    expect(action.action).toBe("cooldown_account");
    if (action.action === "cooldown_account") {
      expect(action.until.toISOString()).toBe("2026-01-15T20:01:00.000Z");
    }
  });

  it("prefers Retry-After over the default cooldown", () => {
    const action = classifyGoogleFailure(
      { status: 429, reason: "rateLimitExceeded", retryAfterSeconds: 300 },
      now,
    );
    if (action.action === "cooldown_account") {
      expect(action.until.toISOString()).toBe("2026-01-15T20:05:00.000Z");
    } else {
      throw new Error(`expected cooldown_account, got ${action.action}`);
    }
  });

  it("treats an account with no channel as unusable for video", () => {
    expect(
      classifyGoogleFailure(
        { status: 401, reason: "youtubeSignupRequired" },
        now,
      ).action,
    ).toBe("fill_account");
  });

  it("retries the same credentials on a backend error", () => {
    expect(
      classifyGoogleFailure({ status: 500, reason: "backendError" }, now)
        .action,
    ).toBe("retry_same");
  });
});

describe("classifyGoogleFailure — status-only fallbacks", () => {
  it("maps a bare 401 to the grant", () => {
    expect(classifyGoogleFailure({ status: 401 }, now).action).toBe(
      "invalidate_grant",
    );
  });

  it("maps a bare 429 to an account cooldown", () => {
    expect(classifyGoogleFailure({ status: 429 }, now).action).toBe(
      "cooldown_account",
    );
  });

  it("maps 5xx to a retry", () => {
    expect(classifyGoogleFailure({ status: 503 }, now).action).toBe(
      "retry_same",
    );
  });

  it("gives up on a 400 with no recognised reason", () => {
    // An unsupported container or a malformed request. No other account or
    // project would have done better, so marching through the pool would just
    // burn quota reproducing the same failure.
    expect(
      classifyGoogleFailure({ status: 400, reason: "badRequest" }, now).action,
    ).toBe("fail");
  });
});

describe("shouldTryAnotherGrant", () => {
  it("moves on for anything scoped to a pool member", () => {
    const moveOn = [
      classifyGoogleFailure({ status: 403, reason: "quotaExceeded" }, now),
      classifyGoogleFailure(
        { status: 403, reason: "storageQuotaExceeded" },
        now,
      ),
      classifyGoogleFailure({ status: 400, reason: "invalid_grant" }, now),
      classifyGoogleFailure({ status: 403, reason: "invalid_client" }, now),
    ];
    for (const action of moveOn) {
      expect(shouldTryAnotherGrant(action)).toBe(true);
    }
  });

  it("stays put for transient and fatal failures", () => {
    expect(
      shouldTryAnotherGrant(
        classifyGoogleFailure({ status: 500, reason: "backendError" }, now),
      ),
    ).toBe(false);
    expect(
      shouldTryAnotherGrant(classifyGoogleFailure({ status: 400 }, now)),
    ).toBe(false);
  });
});
