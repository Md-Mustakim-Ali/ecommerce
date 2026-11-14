import { describe, expect, it } from "vitest";
import {
  type AssetSummary,
  canPublish,
  type MediaState,
  mediaReadiness,
  type ProductPublishState,
  readinessLabel,
  shouldAutoPublish,
} from "./publish";

const assets = (...states: MediaState[]): AssetSummary[] =>
  states.map((state, i) => ({ id: `m${i}`, state }));

const draftAuto: ProductPublishState = {
  status: "draft",
  publishMode: "when_media_ready",
};
const draftManual: ProductPublishState = {
  status: "draft",
  publishMode: "manual",
};

describe("mediaReadiness", () => {
  it("counts each bucket", () => {
    const readiness = mediaReadiness(
      assets("ready", "ready", "processing", "failed", "unavailable"),
    );
    expect(readiness).toMatchObject({
      total: 5,
      ready: 2,
      settling: 1,
      failed: 1,
      unavailable: 1,
      allSettled: false,
    });
  });

  it("treats queued, uploading and processing as in flight", () => {
    expect(mediaReadiness(assets("queued")).settling).toBe(1);
    expect(mediaReadiness(assets("uploading")).settling).toBe(1);
    expect(mediaReadiness(assets("processing")).settling).toBe(1);
  });

  it("settles a product with no media", () => {
    expect(mediaReadiness([]).allSettled).toBe(true);
  });
});

describe("canPublish", () => {
  it("blocks while anything is still uploading", () => {
    const result = canPublish(assets("ready", "processing"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/still uploading/);
  });

  it("pluralises honestly", () => {
    const one = canPublish(assets("queued"));
    const many = canPublish(assets("queued", "processing"));
    if (!one.ok) expect(one.reason).toMatch(/^One file is/);
    if (!many.ok) expect(many.reason).toMatch(/^2 files are/);
  });

  it("allows a product with no media at all", () => {
    // Legal before any of this existed. Tightening it here would break
    // listings that are live today.
    expect(canPublish([])).toEqual({ ok: true, warning: null });
  });

  it("allows publishing with a failed asset, but says so", () => {
    // One rejected video must not hold six good photos hostage forever.
    const result = canPublish(assets("ready", "failed"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warning).toMatch(/could not be uploaded/);
  });

  it("does not warn when everything is ready", () => {
    expect(canPublish(assets("ready", "ready"))).toEqual({
      ok: true,
      warning: null,
    });
  });
});

describe("shouldAutoPublish", () => {
  it("publishes once the last asset lands", () => {
    expect(shouldAutoPublish(draftAuto, assets("ready", "ready"))).toBe(true);
  });

  it("waits while anything is in flight", () => {
    expect(shouldAutoPublish(draftAuto, assets("ready", "processing"))).toBe(
      false,
    );
  });

  it("ignores products set to publish manually", () => {
    expect(shouldAutoPublish(draftManual, assets("ready"))).toBe(false);
  });

  it("never resurrects an archived product", () => {
    // A stale upload completing weeks later must not put a withdrawn listing
    // back on the storefront.
    expect(
      shouldAutoPublish(
        { status: "archived", publishMode: "when_media_ready" },
        assets("ready"),
      ),
    ).toBe(false);
  });

  it("does not re-publish something already active", () => {
    expect(
      shouldAutoPublish(
        { status: "active", publishMode: "when_media_ready" },
        assets("ready"),
      ),
    ).toBe(false);
  });

  it("does not fire for a product with no media", () => {
    // Otherwise a draft saved with the auto setting publishes the instant it
    // is created, which is not what "when media is ready" means to anyone.
    expect(shouldAutoPublish(draftAuto, [])).toBe(false);
  });

  it("does not publish a listing whose media all failed", () => {
    expect(shouldAutoPublish(draftAuto, assets("failed", "failed"))).toBe(
      false,
    );
  });

  it("publishes when some failed but at least one is ready", () => {
    expect(shouldAutoPublish(draftAuto, assets("ready", "failed"))).toBe(true);
  });
});

describe("readinessLabel", () => {
  it("promises auto-publish only when that is the setting", () => {
    expect(readinessLabel(draftAuto, assets("ready", "processing"))).toMatch(
      /Publishes automatically/,
    );
    expect(
      readinessLabel(draftManual, assets("ready", "processing")),
    ).not.toMatch(/Publishes automatically/);
  });

  it("reports assets that vanished at the source", () => {
    expect(readinessLabel(draftManual, assets("ready", "unavailable"))).toMatch(
      /no longer available/,
    );
  });

  it("says nothing when everything is fine", () => {
    expect(readinessLabel(draftManual, assets("ready", "ready"))).toBeNull();
    expect(readinessLabel(draftManual, [])).toBeNull();
  });
});
