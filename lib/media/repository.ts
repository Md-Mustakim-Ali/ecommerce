import { and, asc, eq, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  productImages,
  products,
  storeGoogleAccounts,
  storeGoogleGrants,
  storeGoogleProjects,
} from "@/lib/db/schema";
import { decryptSecret } from "./crypto";
import type { FailoverSink } from "./failover";
import type { GrantCandidate } from "./picker";
import { nextQuotaResetAt, YOUTUBE_COST } from "./quota";

/**
 * The database behind the picker and the failover loop.
 *
 * Everything above this file is pure. This is the only place that knows the
 * pool lives in Postgres, which is what let the routing rules be tested
 * exhaustively without a database or a Google account.
 */

/**
 * Every usable pairing for a store, shaped for the picker.
 *
 * Deliberately unfiltered on state: a project marked `quota_exhausted` before
 * a reset that has since passed is perfectly usable, and the picker knows how
 * to work that out from the ledger. Filtering here would hide capacity from
 * the one component qualified to judge it.
 */
export async function loadGrantCandidates(
  storeId: string,
): Promise<GrantCandidate[]> {
  const rows = await db
    .select({
      grantId: storeGoogleGrants.id,
      grantState: storeGoogleGrants.state,
      projectId: storeGoogleProjects.id,
      projectState: storeGoogleProjects.state,
      projectPriority: storeGoogleProjects.priority,
      unitsUsed: storeGoogleProjects.unitsUsed,
      dailyUnitLimit: storeGoogleProjects.dailyUnitLimit,
      unitsResetAt: storeGoogleProjects.unitsResetAt,
      accountId: storeGoogleAccounts.id,
      accountState: storeGoogleAccounts.state,
      accountPriority: storeGoogleAccounts.priority,
      cooldownUntil: storeGoogleAccounts.cooldownUntil,
      storageLimitBytes: storeGoogleAccounts.storageLimitBytes,
      storageUsageBytes: storeGoogleAccounts.storageUsageBytes,
    })
    .from(storeGoogleGrants)
    .innerJoin(
      storeGoogleProjects,
      eq(storeGoogleProjects.id, storeGoogleGrants.projectId),
    )
    .innerJoin(
      storeGoogleAccounts,
      eq(storeGoogleAccounts.id, storeGoogleGrants.accountId),
    )
    .where(
      and(
        eq(storeGoogleProjects.storeId, storeId),
        eq(storeGoogleAccounts.storeId, storeId),
      ),
    )
    .orderBy(
      asc(storeGoogleAccounts.priority),
      asc(storeGoogleProjects.priority),
    );

  return rows.map((row) => ({
    grantId: row.grantId,
    projectId: row.projectId,
    accountId: row.accountId,
    grantState: row.grantState,
    projectState: row.projectState,
    projectPriority: row.projectPriority,
    projectLedger: {
      unitsUsed: row.unitsUsed,
      dailyUnitLimit: row.dailyUnitLimit,
      unitsResetAt: row.unitsResetAt,
    },
    accountState: row.accountState,
    accountPriority: row.accountPriority,
    accountCooldownUntil: row.cooldownUntil,
    storageLimitBytes: row.storageLimitBytes,
    storageUsageBytes: row.storageUsageBytes,
  }));
}

/** Decrypted credentials for one grant. Never logged, never returned to a client. */
export async function loadGrantCredentials(grantId: string): Promise<{
  clientId: string;
  clientSecret: string;
  refreshToken: string;
} | null> {
  const [row] = await db
    .select({
      clientId: storeGoogleProjects.clientId,
      clientSecretEnc: storeGoogleProjects.clientSecretEnc,
      refreshTokenEnc: storeGoogleGrants.refreshTokenEnc,
    })
    .from(storeGoogleGrants)
    .innerJoin(
      storeGoogleProjects,
      eq(storeGoogleProjects.id, storeGoogleGrants.projectId),
    )
    .where(eq(storeGoogleGrants.id, grantId))
    .limit(1);

  if (!row) return null;

  return {
    clientId: row.clientId,
    clientSecret: decryptSecret(row.clientSecretEnc),
    refreshToken: decryptSecret(row.refreshTokenEnc),
  };
}

export function databaseFailoverSink(
  now: () => Date = () => new Date(),
): FailoverSink {
  return {
    async markProject({ projectId, state, retryAfter, reason }) {
      await db
        .update(storeGoogleProjects)
        .set({
          state,
          lastError: reason.slice(0, 500),
          lastErrorAt: now(),
          // Google is authoritative: if it says the budget is gone, the local
          // count was wrong, so the ledger is filled rather than incremented.
          ...(state === "quota_exhausted"
            ? {
                unitsUsed: sql`${storeGoogleProjects.dailyUnitLimit}`,
                unitsResetAt: retryAfter ?? nextQuotaResetAt(now()),
              }
            : {}),
        })
        .where(eq(storeGoogleProjects.id, projectId));
    },

    async markAccount({ accountId, state, cooldownUntil, reason }) {
      await db
        .update(storeGoogleAccounts)
        .set({
          state,
          cooldownUntil: cooldownUntil ?? null,
          lastError: reason.slice(0, 500),
          lastErrorAt: now(),
        })
        .where(eq(storeGoogleAccounts.id, accountId));
    },

    async markGrant({ grantId, state, reason }) {
      await db
        .update(storeGoogleGrants)
        .set({
          state,
          lastError: reason.slice(0, 500),
          lastErrorAt: now(),
        })
        .where(eq(storeGoogleGrants.id, grantId));
    },

    async spendUnits({ projectId, operation }) {
      const at = now();
      const cost = YOUTUBE_COST[operation];

      // One statement, so two uploads racing cannot both read the same count
      // and write back the same total — which on a six-a-day budget is a whole
      // upload lost. The CASE rolls a lapsed window over in the same write.
      await db
        .update(storeGoogleProjects)
        .set({
          unitsUsed: sql`case when ${storeGoogleProjects.unitsResetAt} <= ${at} then ${cost} else ${storeGoogleProjects.unitsUsed} + ${cost} end`,
          unitsResetAt: sql`case when ${storeGoogleProjects.unitsResetAt} <= ${at} then ${nextQuotaResetAt(at)} else ${storeGoogleProjects.unitsResetAt} end`,
        })
        .where(eq(storeGoogleProjects.id, projectId));
    },

    async markGrantUsed({ grantId }) {
      await db
        .update(storeGoogleGrants)
        .set({ lastUsedAt: now(), lastError: null, lastErrorAt: null })
        .where(eq(storeGoogleGrants.id, grantId));
    },
  };
}

// ── Pending media ─────────────────────────────────────────────────────────

export type PendingMediaRow = {
  id: string;
  productId: string;
  storeId: string;
  kind: "image" | "video";
  provider: "managed" | "drive" | "youtube";
  providerRef: string | null;
  googleAccountId: string | null;
  state:
    | "queued"
    | "uploading"
    | "processing"
    | "ready"
    | "failed"
    | "unavailable";
  checkAttempts: number;
  lastCheckedAt: Date | null;
  createdAt: Date;
};

/**
 * Assets the sweeper should look at, oldest first.
 *
 * Bounded, because this runs on a free instance with a request timeout. A
 * backlog is drained across several sweeps rather than one heroic pass that
 * gets killed halfway and leaves the counters half-written.
 *
 * `storeId` narrows it to one store, for the sweep that rides along with a
 * seller opening their own dashboard. Without the filter a busy store could
 * fill the limit and a quiet one would never see its own uploads advance on
 * the page where its owner is waiting for them.
 */
export async function loadPendingMedia(
  limit = 25,
  storeId?: string,
): Promise<PendingMediaRow[]> {
  return db
    .select({
      id: productImages.id,
      productId: productImages.productId,
      storeId: products.storeId,
      kind: productImages.kind,
      provider: productImages.provider,
      providerRef: productImages.providerRef,
      googleAccountId: productImages.googleAccountId,
      state: productImages.state,
      checkAttempts: productImages.checkAttempts,
      lastCheckedAt: productImages.lastCheckedAt,
      createdAt: productImages.createdAt,
    })
    .from(productImages)
    .innerJoin(products, eq(products.id, productImages.productId))
    .where(
      and(
        inArray(productImages.state, ["queued", "uploading", "processing"]),
        isNotNull(productImages.providerRef),
        ...(storeId ? [eq(products.storeId, storeId)] : []),
      ),
    )
    .orderBy(asc(productImages.lastCheckedAt), asc(productImages.createdAt))
    .limit(limit);
}

/**
 * Media that is live and due a liveness check.
 *
 * Ordered by least-recently-verified so the oldest information is refreshed
 * first, and nothing can starve behind a busy store.
 */
export async function loadMediaDueForReverification(
  before: Date,
  limit = 25,
): Promise<PendingMediaRow[]> {
  return db
    .select({
      id: productImages.id,
      productId: productImages.productId,
      storeId: products.storeId,
      kind: productImages.kind,
      provider: productImages.provider,
      providerRef: productImages.providerRef,
      googleAccountId: productImages.googleAccountId,
      state: productImages.state,
      checkAttempts: productImages.checkAttempts,
      lastCheckedAt: productImages.lastCheckedAt,
      createdAt: productImages.createdAt,
    })
    .from(productImages)
    .innerJoin(products, eq(products.id, productImages.productId))
    .where(
      and(
        eq(productImages.state, "ready"),
        isNotNull(productImages.providerRef),
        inArray(productImages.provider, ["drive", "youtube"]),
        or(
          sql`${productImages.lastCheckedAt} is null`,
          lte(productImages.lastCheckedAt, before),
        ),
      ),
    )
    .orderBy(asc(productImages.lastCheckedAt))
    .limit(limit);
}

export async function recordMediaCheck(input: {
  mediaId: string;
  state: PendingMediaRow["state"];
  at: Date;
  incrementAttempts: boolean;
  failureReason?: string | null;
  url?: string | null;
  durationSeconds?: number | null;
  width?: number | null;
  height?: number | null;
}): Promise<void> {
  await db
    .update(productImages)
    .set({
      state: input.state,
      lastCheckedAt: input.at,
      ...(input.incrementAttempts
        ? { checkAttempts: sql`${productImages.checkAttempts} + 1` }
        : {}),
      ...(input.failureReason !== undefined
        ? { failureReason: input.failureReason }
        : {}),
      ...(input.url !== undefined ? { url: input.url } : {}),
      ...(input.durationSeconds !== undefined
        ? { durationSeconds: input.durationSeconds }
        : {}),
      ...(input.width !== undefined ? { width: input.width } : {}),
      ...(input.height !== undefined ? { height: input.height } : {}),
    })
    .where(eq(productImages.id, input.mediaId));
}

/**
 * Everything the publish gate needs about one product.
 *
 * Assets are every row on the product regardless of placement — a video
 * embedded in the description holds publication exactly as a gallery video
 * does, which is the whole reason both live in one table.
 */
export async function loadProductPublishContext(productId: string): Promise<{
  status: "draft" | "active" | "archived";
  publishMode: "manual" | "when_media_ready";
  slug: string;
  storeId: string;
  assets: { id: string; state: PendingMediaRow["state"] }[];
} | null> {
  const [product] = await db
    .select({
      status: products.status,
      publishMode: products.publishMode,
      slug: products.slug,
      storeId: products.storeId,
    })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);

  if (!product) return null;

  const assets = await db
    .select({ id: productImages.id, state: productImages.state })
    .from(productImages)
    .where(eq(productImages.productId, productId));

  return { ...product, assets };
}

/**
 * Publishes, but only from draft.
 *
 * The status check is in the WHERE clause rather than read-then-write because
 * the sweeper and the seller can act at the same moment, and the row this is
 * based on was read before the media check went out to Google. Losing that
 * race would resurrect a product the seller archived while a slow upload was
 * still in flight.
 */
export async function autoPublishProduct(
  productId: string,
  at: Date,
): Promise<boolean> {
  const updated = await db
    .update(products)
    .set({ status: "active", publishedAt: at })
    .where(and(eq(products.id, productId), eq(products.status, "draft")))
    .returning({ id: products.id });

  return updated.length > 0;
}

/** What the proxy route needs to stream a Drive-backed asset. */
export async function loadServableMedia(mediaId: string): Promise<{
  provider: "managed" | "drive" | "youtube";
  providerRef: string | null;
  googleAccountId: string | null;
  storeId: string;
  state: PendingMediaRow["state"];
} | null> {
  const [row] = await db
    .select({
      provider: productImages.provider,
      providerRef: productImages.providerRef,
      googleAccountId: productImages.googleAccountId,
      storeId: products.storeId,
      state: productImages.state,
    })
    .from(productImages)
    .innerJoin(products, eq(products.id, productImages.productId))
    .where(eq(productImages.id, mediaId))
    .limit(1);

  return row ?? null;
}

/** Refreshes an account's cached Drive usage. */
export async function recordStorageQuota(input: {
  accountId: string;
  limitBytes: number | null;
  usageBytes: number;
  at: Date;
}): Promise<void> {
  await db
    .update(storeGoogleAccounts)
    .set({
      storageLimitBytes: input.limitBytes,
      storageUsageBytes: input.usageBytes,
      storageCheckedAt: input.at,
      // A successful quota read proves the account is reachable again.
      ...(input.limitBytes === null || input.usageBytes < input.limitBytes
        ? { state: "active" as const, cooldownUntil: null }
        : {}),
    })
    .where(eq(storeGoogleAccounts.id, input.accountId));
}
