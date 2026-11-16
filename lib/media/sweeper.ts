import { GoogleApiError } from "./failover";
import { evaluateFileReadiness } from "./google/drive";
import { accessTokenForGrant, googleFetch } from "./google/oauth";
import { fetchVideoStatus } from "./google/youtube";
import type { GrantCandidate } from "./picker";
import { shouldAutoPublish } from "./publish";
import {
  autoPublishProduct,
  loadGrantCandidates,
  loadGrantCredentials,
  loadMediaDueForReverification,
  loadPendingMedia,
  loadProductPublishContext,
  type PendingMediaRow,
  recordMediaCheck,
} from "./repository";
import {
  isDueForCheck,
  isDueForReverification,
  REVERIFY_INTERVAL_MS,
  shouldGiveUp,
} from "./schedule";

/**
 * The poller that moves media from "uploading" to "ready", and publishes the
 * products that were waiting on it.
 *
 * This project has no cron by design — lib/ratelimit sweeps opportunistically
 * for the same reason, and Render's free plan has no scheduler. So this is a
 * plain function, called from a route that an external schedule pokes and from
 * the seller's own dashboard load. Both paths are safe to run concurrently:
 * every write is idempotent and guarded, because two sweeps overlapping is the
 * normal case rather than the exception.
 */

export type SweepSummary = {
  checked: number;
  becameReady: number;
  failed: number;
  published: string[];
  skipped: number;
  errors: { mediaId: string; message: string }[];
};

const emptySummary = (): SweepSummary => ({
  checked: 0,
  becameReady: 0,
  failed: 0,
  published: [],
  skipped: 0,
  errors: [],
});

/**
 * A grant that can read on behalf of the account holding this asset.
 *
 * Reads cost one unit, so any project paired with the right account will do —
 * but it must be the right ACCOUNT, because only the account that owns a file
 * can see it. Falling back to any grant at all covers rows uploaded before an
 * account was recorded.
 */
function grantForAsset(
  candidates: readonly GrantCandidate[],
  accountId: string | null,
): GrantCandidate | null {
  const healthy = candidates.filter(
    (candidate) =>
      candidate.grantState === "active" &&
      candidate.projectState !== "invalid" &&
      candidate.projectState !== "disabled" &&
      candidate.accountState !== "revoked" &&
      candidate.accountState !== "disabled",
  );

  if (accountId) {
    return healthy.find((c) => c.accountId === accountId) ?? null;
  }
  return healthy[0] ?? null;
}

async function checkOne(
  asset: PendingMediaRow,
  candidates: readonly GrantCandidate[],
  now: Date,
  summary: SweepSummary,
): Promise<void> {
  const grant = grantForAsset(candidates, asset.googleAccountId);
  if (!grant || !asset.providerRef) {
    summary.skipped++;
    return;
  }

  const credentials = await loadGrantCredentials(grant.grantId);
  if (!credentials) {
    summary.skipped++;
    return;
  }

  const token = await accessTokenForGrant(grant.grantId, credentials, now);

  if (asset.provider === "youtube") {
    const readiness = await fetchVideoStatus(token, asset.providerRef);

    if (readiness.state === "processing") {
      // Attempts increment only while genuinely waiting, so the give-up
      // ceiling measures patience rather than counting successful polls.
      await recordMediaCheck({
        mediaId: asset.id,
        state: "processing",
        at: now,
        incrementAttempts: true,
      });
      return;
    }

    if (readiness.state === "ready") {
      await recordMediaCheck({
        mediaId: asset.id,
        state: "ready",
        at: now,
        incrementAttempts: false,
        failureReason: null,
        url: readiness.thumbnailUrl,
        durationSeconds: readiness.durationSeconds,
      });
      summary.becameReady++;
      return;
    }

    await recordMediaCheck({
      mediaId: asset.id,
      state: readiness.state,
      at: now,
      incrementAttempts: false,
      failureReason: readiness.reason,
    });
    summary.failed++;
    return;
  }

  if (asset.provider === "drive") {
    const body = (await googleFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(asset.providerRef)}?fields=id,name,size,mimeType,trashed,imageMediaMetadata`,
      { accessToken: token, method: "GET" },
    )) as Parameters<typeof evaluateFileReadiness>[0];

    const readiness = evaluateFileReadiness(body);

    if (readiness.state === "ready") {
      await recordMediaCheck({
        mediaId: asset.id,
        state: "ready",
        at: now,
        incrementAttempts: false,
        failureReason: null,
        // Served from our own origin rather than linked to Drive directly.
        url: `/api/media/${asset.id}`,
        width: readiness.width,
        height: readiness.height,
      });
      summary.becameReady++;
      return;
    }

    await recordMediaCheck({
      mediaId: asset.id,
      state: readiness.state,
      at: now,
      incrementAttempts: false,
      failureReason: readiness.reason,
    });
    summary.failed++;
    return;
  }

  summary.skipped++;
}

/**
 * One pass over pending media, followed by the publish decisions it unblocked.
 *
 * Failures are collected rather than thrown: one seller's revoked account must
 * not stop the sweep for every other store, which is exactly what an
 * unhandled rejection here would do.
 */
export async function sweepPendingMedia(
  now: Date = new Date(),
  limit = 25,
): Promise<SweepSummary> {
  return advance(await loadPendingMedia(limit), now);
}

/**
 * The same pass, narrowed to one store, for a seller's own dashboard load.
 *
 * The scheduled sweep is late by design — hourly, plus whatever delay GitHub's
 * scheduler adds — which is fine for auto-publishing while nobody is looking
 * and poor for the person refreshing the page waiting on their video. This
 * runs where they already are.
 *
 * A smaller limit than the scheduled sweep on purpose. This one is riding on
 * somebody's page load rather than a job with eight minutes to spend, and a
 * seller with forty pending photos is better served by four quick passes than
 * one that holds the instance for a minute.
 */
export async function sweepStoreMedia(
  storeId: string,
  now: Date = new Date(),
  limit = 10,
): Promise<SweepSummary> {
  return advance(await loadPendingMedia(limit, storeId), now);
}

async function advance(
  pending: readonly PendingMediaRow[],
  now: Date,
): Promise<SweepSummary> {
  const summary = emptySummary();
  if (pending.length === 0) return summary;

  const candidatesByStore = new Map<string, GrantCandidate[]>();
  const touchedProducts = new Set<string>();

  for (const asset of pending) {
    if (!isDueForCheck(asset, now)) {
      summary.skipped++;
      continue;
    }

    const giveUp = shouldGiveUp(asset, now);
    if (giveUp.giveUp) {
      await recordMediaCheck({
        mediaId: asset.id,
        state: "failed",
        at: now,
        incrementAttempts: false,
        failureReason: giveUp.reason,
      });
      summary.failed++;
      touchedProducts.add(asset.productId);
      continue;
    }

    let candidates = candidatesByStore.get(asset.storeId);
    if (!candidates) {
      candidates = await loadGrantCandidates(asset.storeId);
      candidatesByStore.set(asset.storeId, candidates);
    }

    summary.checked++;
    touchedProducts.add(asset.productId);

    try {
      await checkOne(asset, candidates, now, summary);
    } catch (error) {
      const message =
        error instanceof GoogleApiError
          ? (error.failure.message ?? error.message)
          : error instanceof Error
            ? error.message
            : String(error);

      summary.errors.push({ mediaId: asset.id, message });

      // Recorded as an attempt rather than a failure: a transient Google
      // error must not condemn an asset that is probably fine. The give-up
      // ceiling is what eventually stops it.
      await recordMediaCheck({
        mediaId: asset.id,
        state: asset.state,
        at: now,
        incrementAttempts: true,
      });
    }
  }

  for (const productId of touchedProducts) {
    const published = await maybeAutoPublish(productId, now);
    if (published) summary.published.push(productId);
  }

  return summary;
}

/**
 * Publishes a product if its last asset just landed and it asked to be.
 *
 * Safe to call for any product at any time — the gate does the deciding, and
 * autoPublishProduct only moves a row that is still draft.
 */
export async function maybeAutoPublish(
  productId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const context = await loadProductPublishContext(productId);
  if (!context) return false;

  if (
    !shouldAutoPublish(
      { status: context.status, publishMode: context.publishMode },
      context.assets,
    )
  ) {
    return false;
  }

  return autoPublishProduct(productId, now);
}

/**
 * Re-checks media that is already live.
 *
 * The case this exists for is the one nobody plans for: a seller tidies their
 * Drive or flips a video to private weeks after launch, and a product that is
 * actively selling grows a broken image. The row still says `ready`, so
 * nothing else in the system would ever notice.
 *
 * A product is not unpublished automatically. Taking a selling listing off the
 * storefront over one missing photo is a bigger harm than the photo; the row
 * goes `unavailable`, it stops rendering, and the seller is shown the problem.
 */
export async function reverifyLiveMedia(
  now: Date = new Date(),
  limit = 25,
): Promise<SweepSummary> {
  const summary = emptySummary();
  const cutoff = new Date(now.getTime() - REVERIFY_INTERVAL_MS);
  const live = await loadMediaDueForReverification(cutoff, limit);
  if (live.length === 0) return summary;

  const candidatesByStore = new Map<string, GrantCandidate[]>();

  for (const asset of live) {
    if (!isDueForReverification(asset.lastCheckedAt, now)) {
      summary.skipped++;
      continue;
    }

    let candidates = candidatesByStore.get(asset.storeId);
    if (!candidates) {
      candidates = await loadGrantCandidates(asset.storeId);
      candidatesByStore.set(asset.storeId, candidates);
    }

    summary.checked++;

    try {
      await checkOne(asset, candidates, now, summary);
    } catch (error) {
      summary.errors.push({
        mediaId: asset.id,
        message: error instanceof Error ? error.message : String(error),
      });
      // Left `ready` on purpose. A network blip is not evidence that a photo
      // which has worked for six weeks has stopped existing, and blanking it
      // would break a live product over a failed request.
      await recordMediaCheck({
        mediaId: asset.id,
        state: "ready",
        at: now,
        incrementAttempts: false,
      });
    }
  }

  return summary;
}
