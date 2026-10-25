import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/lib/db";
import {
  type PlacementSlotName,
  pageBlocks,
  pages,
  placements,
  placementTargets,
  stores,
} from "@/lib/db/schema";
import {
  isScheduledNow,
  placementApplies,
  type RouteContext,
} from "./placement-rules";

export type { RouteContext };

/** A published page, by slug. Store pages are scoped to their store. */
export const getPublishedPage = cache(
  async (slug: string, storeSlug?: string) => {
    const storeId = storeSlug
      ? (
          await db
            .select({ id: stores.id })
            .from(stores)
            .where(and(eq(stores.slug, storeSlug), eq(stores.status, "active")))
            .limit(1)
        )[0]?.id
      : undefined;

    if (storeSlug && !storeId) return null;

    const [page] = await db
      .select()
      .from(pages)
      .where(
        and(
          eq(pages.slug, slug),
          eq(pages.status, "published"),
          storeId ? eq(pages.storeId, storeId) : isNull(pages.storeId),
        ),
      )
      .limit(1);

    if (!page) return null;

    const blocks = await db
      .select({
        id: pageBlocks.id,
        type: pageBlocks.type,
        data: pageBlocks.data,
      })
      .from(pageBlocks)
      .where(eq(pageBlocks.pageId, page.id))
      .orderBy(asc(pageBlocks.position));

    return { ...page, blocks };
  },
);

export type ResolvedPlacement = {
  id: string;
  type: string;
  slot: PlacementSlotName;
  data: Record<string, unknown>;
  /**
   * Who put this here. Carried all the way to the customer, because a buyer
   * seeing "20% off" on a product page has no way to tell whether the seller
   * is offering it or the marketplace is, and those are different promises
   * with different people standing behind them.
   */
  scope: "platform" | "store";
  /** The store's display name, when the placement is a store's own. */
  storeName: string | null;
};

/**
 * Placements that apply to the current route.
 *
 * The scheduling window and status are filtered in SQL; the targeting rules
 * are evaluated in TypeScript by placement-rules.ts, which is pure and
 * exhaustively tested. Expressing "category, including descendants, unless
 * excluded" as SQL would be both harder to read and harder to trust.
 *
 * Store-scoped placements only apply on that store's own surfaces, so one
 * seller cannot put a banner on another seller's product page.
 */
export const getPlacementsForRoute = cache(
  async (route: RouteContext): Promise<ResolvedPlacement[]> => {
    const rows = await db
      .select({
        id: placements.id,
        type: placements.type,
        slot: placements.slot,
        data: placements.data,
        priority: placements.priority,
        status: placements.status,
        startsAt: placements.startsAt,
        endsAt: placements.endsAt,
        scope: placements.scope,
        storeSlug: stores.slug,
        storeName: stores.name,
        targetType: placementTargets.targetType,
        targetValue: placementTargets.targetValue,
        isExclusion: placementTargets.isExclusion,
      })
      .from(placements)
      .leftJoin(stores, eq(stores.id, placements.storeId))
      .leftJoin(
        placementTargets,
        eq(placementTargets.placementId, placements.id),
      )
      .where(
        and(
          eq(placements.status, "published"),
          // Store placements only reach their own store's pages.
          or(
            eq(placements.scope, "platform"),
            route.storeSlug ? eq(stores.slug, route.storeSlug) : undefined,
          ),
        ),
      )
      .orderBy(desc(placements.priority));

    const grouped = new Map<
      string,
      {
        placement: ResolvedPlacement & {
          priority: number;
          status: string;
          startsAt: Date | null;
          endsAt: Date | null;
        };
        targets: {
          targetType: NonNullable<(typeof rows)[number]["targetType"]>;
          targetValue: string | null;
          isExclusion: boolean;
        }[];
      }
    >();

    for (const row of rows) {
      let entry = grouped.get(row.id);
      if (!entry) {
        entry = {
          placement: {
            id: row.id,
            type: row.type,
            slot: row.slot,
            data: row.data ?? {},
            scope: row.scope,
            storeName: row.storeName,
            priority: row.priority,
            status: row.status,
            startsAt: row.startsAt,
            endsAt: row.endsAt,
          },
          targets: [],
        };
        grouped.set(row.id, entry);
      }
      // The left join yields a null target row for a placement with no rules.
      if (row.targetType) {
        entry.targets.push({
          targetType: row.targetType,
          targetValue: row.targetValue,
          isExclusion: row.isExclusion ?? false,
        });
      }
    }

    return [...grouped.values()]
      .filter(
        ({ placement, targets }) =>
          isScheduledNow(placement) && placementApplies(targets, route),
      )
      .sort((a, b) => b.placement.priority - a.placement.priority)
      .map(({ placement }) => ({
        id: placement.id,
        type: placement.type,
        slot: placement.slot,
        data: placement.data,
        scope: placement.scope,
        storeName: placement.storeName,
      }));
  },
);

export function placementsInSlot(
  placements: ResolvedPlacement[],
  slot: PlacementSlotName,
) {
  return placements.filter((p) => p.slot === slot);
}

/**
 * Offers that belong inside a product grid on this route.
 *
 * A grid is rendered by a component that takes data, not by a slot component
 * that fetches its own, so the page resolves these and passes them down.
 * getPlacementsForRoute is request-cached, so a page with both a band and a
 * grid still makes one query.
 */
export async function getGridOffers(
  route: RouteContext,
): Promise<ResolvedPlacement[]> {
  return placementsInSlot(await getPlacementsForRoute(route), "in_grid");
}

/** Pages in a scope, for the editor. Includes drafts. */
export async function listPagesInScope(scope: {
  scope: "platform" | "store";
  storeId?: string;
}) {
  const rows = await db
    .select({
      id: pages.id,
      slug: pages.slug,
      title: pages.title,
      status: pages.status,
      // Selected so the edit form can prefill without a second round trip per
      // page opened.
      excerpt: pages.excerpt,
      seoTitle: pages.seoTitle,
      seoDescription: pages.seoDescription,
      updatedAt: pages.updatedAt,
    })
    .from(pages)
    .where(
      scope.scope === "store" && scope.storeId
        ? eq(pages.storeId, scope.storeId)
        : isNull(pages.storeId),
    )
    .orderBy(desc(pages.updatedAt));

  if (rows.length === 0) return rows.map((row) => ({ ...row, blockCount: 0 }));

  // A separate grouped query rather than a correlated subquery. Drizzle
  // renders an outer column reference inside a raw sql template unqualified,
  // and Postgres then resolves it against the subquery's own tables — the
  // recurring bug recorded in docs/backend-ui-gaps.md.
  const counts = await db
    .select({
      pageId: pageBlocks.pageId,
      count: sql<number>`count(*)::int`,
    })
    .from(pageBlocks)
    .where(
      inArray(
        pageBlocks.pageId,
        rows.map((row) => row.id),
      ),
    )
    .groupBy(pageBlocks.pageId);

  return rows.map((row) => ({
    ...row,
    blockCount: counts.find((entry) => entry.pageId === row.id)?.count ?? 0,
  }));
}

/** One page with its blocks, for the editor. Drafts included. */
export async function getPageForEditing(
  pageId: string,
  scope: { scope: "platform" | "store"; storeId?: string },
) {
  const [page] = await db
    .select()
    .from(pages)
    .where(
      and(
        eq(pages.id, pageId),
        scope.scope === "store" && scope.storeId
          ? eq(pages.storeId, scope.storeId)
          : isNull(pages.storeId),
      ),
    )
    .limit(1);

  if (!page) return null;

  const blocks = await db
    .select({
      id: pageBlocks.id,
      type: pageBlocks.type,
      data: pageBlocks.data,
      position: pageBlocks.position,
    })
    .from(pageBlocks)
    .where(eq(pageBlocks.pageId, page.id))
    .orderBy(asc(pageBlocks.position));

  return { ...page, blocks };
}

/** Placements in a scope, with their targeting rules, for the editor. */
export async function listPlacementsInScope(scope: {
  scope: "platform" | "store";
  storeId?: string;
}) {
  const rows = await db
    .select({
      id: placements.id,
      type: placements.type,
      slot: placements.slot,
      data: placements.data,
      priority: placements.priority,
      status: placements.status,
      startsAt: placements.startsAt,
      endsAt: placements.endsAt,
      targetType: placementTargets.targetType,
      targetValue: placementTargets.targetValue,
      isExclusion: placementTargets.isExclusion,
    })
    .from(placements)
    .leftJoin(placementTargets, eq(placementTargets.placementId, placements.id))
    .where(
      scope.scope === "store" && scope.storeId
        ? eq(placements.storeId, scope.storeId)
        : isNull(placements.storeId),
    )
    .orderBy(desc(placements.priority));

  const grouped = new Map<
    string,
    {
      id: string;
      type: string;
      slot: string;
      data: Record<string, unknown>;
      priority: number;
      status: string;
      startsAt: Date | null;
      endsAt: Date | null;
      targets: {
        targetType: string;
        targetValue: string | null;
        isExclusion: boolean;
      }[];
    }
  >();

  for (const row of rows) {
    let entry = grouped.get(row.id);
    if (!entry) {
      entry = {
        id: row.id,
        type: row.type,
        slot: row.slot,
        data: row.data ?? {},
        priority: row.priority,
        status: row.status,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        targets: [],
      };
      grouped.set(row.id, entry);
    }
    if (row.targetType) {
      entry.targets.push({
        targetType: row.targetType,
        targetValue: row.targetValue,
        isExclusion: row.isExclusion ?? false,
      });
    }
  }

  return [...grouped.values()];
}
