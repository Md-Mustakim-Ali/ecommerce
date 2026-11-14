/**
 * The readiness gate.
 *
 * A product must not go live while any of its media is still on its way,
 * because seller-supplied media does not become usable at the moment it is
 * accepted — a Drive file has to finish syncing and a YouTube video has to
 * finish transcoding, which can take half an hour for a large one. Publishing
 * before then ships a listing with a dead thumbnail or a "processing" notice
 * where a video should be, and the seller has no way to know when to come back
 * and fix it.
 *
 * Pure functions over a summary of the rows, so the rules are testable without
 * a database and identical wherever they are asked — the publish action, the
 * sweeper deciding whether to auto-publish, and the dashboard badge all have to
 * agree, and the classic way that goes wrong is three slightly different
 * inline conditions.
 */

export type MediaState =
  | "queued"
  | "uploading"
  | "processing"
  | "ready"
  | "failed"
  | "unavailable";

export type AssetSummary = {
  id: string;
  state: MediaState;
};

/**
 * States that are still moving toward ready.
 *
 * These block publication because waiting fixes them. `failed` and
 * `unavailable` are terminal and deliberately absent: a single rejected video
 * must not hold a product's other six photos hostage forever, and an asset
 * that vanished at Google six weeks after launch should raise an alert rather
 * than silently unpublish a listing that is selling.
 */
const SETTLING: readonly MediaState[] = ["queued", "uploading", "processing"];

export function isSettling(state: MediaState): boolean {
  return SETTLING.includes(state);
}

export type Readiness = {
  total: number;
  ready: number;
  settling: number;
  failed: number;
  unavailable: number;
  /** Nothing left in flight. True for a product with no media at all. */
  allSettled: boolean;
};

export function mediaReadiness(assets: readonly AssetSummary[]): Readiness {
  let ready = 0;
  let settling = 0;
  let failed = 0;
  let unavailable = 0;

  for (const asset of assets) {
    if (asset.state === "ready") ready++;
    else if (asset.state === "failed") failed++;
    else if (asset.state === "unavailable") unavailable++;
    else settling++;
  }

  return {
    total: assets.length,
    ready,
    settling,
    failed,
    unavailable,
    allSettled: settling === 0,
  };
}

export type PublishCheck =
  | { ok: true; warning: string | null }
  | { ok: false; reason: string };

/**
 * Whether a seller may publish right now.
 *
 * A product with no media at all is allowed through: that was legal before any
 * of this existed, and tightening it here would break listings that are live
 * today.
 */
export function canPublish(assets: readonly AssetSummary[]): PublishCheck {
  const readiness = mediaReadiness(assets);

  if (readiness.settling > 0) {
    return {
      ok: false,
      reason:
        readiness.settling === 1
          ? "One file is still uploading. It will publish itself when that finishes."
          : `${readiness.settling} files are still uploading. They will publish themselves when that finishes.`,
    };
  }

  const broken = readiness.failed + readiness.unavailable;
  if (broken > 0) {
    return {
      ok: true,
      warning:
        broken === 1
          ? "One file could not be uploaded and will not be shown."
          : `${broken} files could not be uploaded and will not be shown.`,
    };
  }

  return { ok: true, warning: null };
}

export type ProductPublishState = {
  status: "draft" | "active" | "archived";
  publishMode: "manual" | "when_media_ready";
};

/**
 * Whether the sweeper should publish this product now that an asset landed.
 *
 * Three guards, each of which has a failure it prevents:
 *
 *   status must be draft   — an archived product must not resurrect itself
 *                            because a stale upload finally completed.
 *   at least one asset     — otherwise a draft created with the auto setting
 *                            and no media publishes the instant it is saved,
 *                            which is not what "when media is ready" means to
 *                            anyone.
 *   at least one ready     — if every asset failed there is nothing to show,
 *                            and publishing an empty listing is worse than
 *                            leaving it draft with a visible error.
 */
export function shouldAutoPublish(
  product: ProductPublishState,
  assets: readonly AssetSummary[],
): boolean {
  if (product.publishMode !== "when_media_ready") return false;
  if (product.status !== "draft") return false;

  const readiness = mediaReadiness(assets);
  if (readiness.total === 0) return false;
  if (!readiness.allSettled) return false;
  return readiness.ready > 0;
}

/**
 * What the seller sees on the product while it waits.
 *
 * Returned rather than assembled in the component so the dashboard list, the
 * editor header and the sweeper's notification email cannot drift apart.
 */
export function readinessLabel(
  product: ProductPublishState,
  assets: readonly AssetSummary[],
): string | null {
  const readiness = mediaReadiness(assets);

  if (readiness.settling > 0) {
    const suffix =
      product.publishMode === "when_media_ready"
        ? " Publishes automatically when done."
        : "";
    return `${readiness.settling} of ${readiness.total} still uploading.${suffix}`;
  }

  if (readiness.unavailable > 0) {
    return `${readiness.unavailable} file(s) are no longer available at the source.`;
  }

  if (readiness.failed > 0) {
    return `${readiness.failed} file(s) failed to upload.`;
  }

  return null;
}
