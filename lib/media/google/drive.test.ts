import { describe, expect, it } from "vitest";
import { evaluateFileReadiness, parseStorageQuota } from "./drive";

const GB = 1024 * 1024 * 1024;

describe("parseStorageQuota", () => {
  it("reads the string values Google sends", () => {
    // Sent as strings because 2 TB overflows a JSON number in some clients.
    const quota = parseStorageQuota({
      storageQuota: {
        limit: String(15 * GB),
        usage: String(3 * GB),
        usageInDrive: String(1 * GB),
      },
    });
    expect(quota.limitBytes).toBe(15 * GB);
    expect(quota.usageBytes).toBe(3 * GB);
  });

  it("prefers total usage over the Drive-only figure", () => {
    // The free 15 GB is shared with Gmail and Photos. Using usageInDrive would
    // understate how full the account is, and uploads would start failing well
    // before the picker expected them to.
    const quota = parseStorageQuota({
      storageQuota: { usage: String(14 * GB), usageInDrive: String(2 * GB) },
    });
    expect(quota.usageBytes).toBe(14 * GB);
  });

  it("treats an absent limit as unmetered, not as zero", () => {
    // Pooled and enterprise accounts omit `limit`. Reading that as 0 would
    // mark a perfectly good account permanently full.
    const quota = parseStorageQuota({
      storageQuota: { usage: String(50 * GB) },
    });
    expect(quota.limitBytes).toBeNull();
    expect(quota.usageBytes).toBe(50 * GB);
  });

  it("survives a response with no quota block at all", () => {
    expect(parseStorageQuota({})).toEqual({ limitBytes: null, usageBytes: 0 });
  });

  it("does not produce NaN from a malformed value", () => {
    // NaN in a storage figure compares false against everything, which would
    // silently make the picker's capacity check always pass.
    const quota = parseStorageQuota({
      storageQuota: { limit: "unlimited", usage: "lots" },
    });
    expect(quota.limitBytes).toBeNull();
    expect(quota.usageBytes).toBe(0);
  });
});

describe("evaluateFileReadiness", () => {
  it("is ready for a live file, with its dimensions", () => {
    const result = evaluateFileReadiness({
      id: "file-1",
      size: "204800",
      imageMediaMetadata: { width: 1600, height: 1200 },
    });
    expect(result.state).toBe("ready");
    if (result.state === "ready") {
      expect(result.sizeBytes).toBe(204800);
      expect(result.width).toBe(1600);
      expect(result.height).toBe(1200);
    }
  });

  it("catches a file the seller moved to the trash", () => {
    // A trashed file still resolves through the API, so this has to be asked
    // about rather than inferred from a 404. It is the exact case where a
    // seller tidies up months later and breaks live listings.
    const result = evaluateFileReadiness({ id: "file-1", trashed: true });
    expect(result.state).toBe("unavailable");
    if (result.state === "unavailable") {
      expect(result.reason).toMatch(/trash/i);
    }
  });

  it("is unavailable when the response carries no id", () => {
    expect(evaluateFileReadiness({}).state).toBe("unavailable");
  });

  it("copes with a file that reports no size or dimensions", () => {
    const result = evaluateFileReadiness({ id: "file-1" });
    expect(result.state).toBe("ready");
    if (result.state === "ready") {
      expect(result.sizeBytes).toBeNull();
      expect(result.width).toBeNull();
    }
  });
});
