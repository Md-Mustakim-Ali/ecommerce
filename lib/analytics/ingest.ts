import { sql } from "drizzle-orm";
import { z } from "zod";
import { SHOP_TIME_ZONE } from "@/lib/datetime/format";
import { db } from "@/lib/db";
import { analyticsEvents } from "@/lib/db/schema";

/**
 * Turning a batch of things a browser says happened into rows.
 *
 * ── Nothing here is trusted ──────────────────────────────────────────────
 *
 * Every field arrives from a client that anybody can forge, so this endpoint's
 * job is to decide what is worth writing rather than to write what it is told.
 * Types come from a fixed enum, ids must parse as UUIDs, strings are truncated,
 * and the session id is taken from a cookie the server set rather than from the
 * payload — otherwise one script could inflate any product's numbers by
 * inventing a new session per request.
 *
 * The counters this feeds are for a seller's judgement, not for billing. Being
 * approximately right and cheap is the correct trade; being exactly right would
 * mean a write per event with no batching and a bill nobody wants.
 */

const MAX_BATCH = 40;

export const eventTypes = [
  "page_view",
  "product_view",
  "search",
  "product_click",
  "add_to_cart",
  "remove_from_cart",
  "wishlist_add",
  "wishlist_remove",
  "checkout_start",
  "ui_click",
] as const;

export type EventType = (typeof eventTypes)[number];

const incoming = z.object({
  type: z.enum(eventTypes),
  storeId: z.uuid().optional(),
  productId: z.uuid().optional(),
  variantId: z.uuid().optional(),
  /** Query strings are stripped here, not on the client. */
  path: z.string().max(300).optional(),
  label: z.string().max(120).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export const eventBatch = z.object({
  events: z.array(incoming).min(1).max(MAX_BATCH),
});

export type IncomingEvent = z.infer<typeof incoming>;

/**
 * Bots, filtered on the user agent and then the agent is forgotten.
 *
 * Not a security control — anything can claim to be a browser. It is here so a
 * seller's "views" are not mostly Googlebot, which would make the number
 * actively misleading rather than merely imprecise.
 */
export function looksAutomated(userAgent: string | null): boolean {
  if (!userAgent) return true; // A real browser always sends one.
  return /bot|crawl|spider|slurp|bingpreview|headless|lighthouse|curl|wget|python-requests|axios|node-fetch|monitor|pingdom|uptime/i.test(
    userAgent,
  );
}

/** Query strings can carry anything, including tokens. Path only. */
function cleanPath(path: string | undefined): string | null {
  if (!path) return null;
  const withoutQuery = path.split(/[?#]/)[0];
  return withoutQuery.slice(0, 300) || null;
}

/**
 * Writes a batch: raw rows, then the counters those rows move.
 *
 * ── Why the counter is not just `count(*)` later ─────────────────────────
 *
 * Because the raw table is swept after a fortnight and the grids show a
 * quarter. Aggregating on read would mean either keeping every row for ever or
 * showing a chart that silently loses its own history — and on a database that
 * bills for compute, scanning months of views to draw one page is the expensive
 * way to be wrong.
 *
 * ── Sessions ─────────────────────────────────────────────────────────────
 *
 * `sessions` counts browsers, not events, because one person refreshing a page
 * six times is not six people and a seller reading "6 views" would think it
 * was. It is maintained by inserting into a claim table whose unique index
 * makes the second attempt for the same (day, key, session) do nothing — so the
 * increment happens exactly once, without a `count(distinct)` over the stream.
 */
export async function recordEvents(
  sessionId: string,
  userId: string | null,
  events: IncomingEvent[],
): Promise<{ written: number }> {
  if (events.length === 0) return { written: 0 };

  const rows = events.slice(0, MAX_BATCH).map((event) => ({
    type: event.type,
    sessionId,
    userId,
    storeId: event.storeId ?? null,
    productId: event.productId ?? null,
    variantId: event.variantId ?? null,
    path: cleanPath(event.path),
    label: event.label?.slice(0, 120) ?? null,
    meta: event.meta ?? null,
  }));

  await db.insert(analyticsEvents).values(rows);

  /*
    The counters, one statement per row rather than one big one.

    Deliberate: the events in a batch usually touch different keys, and a
    multi-row upsert that hits the same key twice within one statement raises
    "cannot affect row a second time" in Postgres. Batches are at most forty
    and this is not a hot path a person waits on — the endpoint answers before
    it finishes, see the route.
  */
  const NIL = "00000000-0000-0000-0000-000000000000";
  for (const row of rows) {
    // The day in the shop's own timezone. Using UTC would file an evening
    // order in Dhaka under the previous day, exactly as the buyer pages did.
    const day = sql`(now() at time zone ${SHOP_TIME_ZONE})::date`;

    /*
      Claim the session for this key and day. The unique index means a repeat
      inserts nothing, and `xmax = 0` is Postgres's way of saying the row was
      genuinely inserted rather than skipped — which is what decides whether
      `sessions` goes up.
    */
    const claimed = await db.execute<{ inserted: boolean }>(sql`
      insert into analytics_daily_sessions (day, type, store_id, product_id, session_id)
      values (${day}, ${row.type}, ${row.storeId}, ${row.productId}, ${sessionId})
      on conflict do nothing
      returning true as inserted
    `);
    const firstOfSession = claimed.length > 0;

    await db.execute(sql`
      insert into analytics_daily (day, type, store_id, product_id, variant_id, events, sessions)
      values (${day}, ${row.type}, ${row.storeId}, ${row.productId}, ${row.variantId}, 1, ${firstOfSession ? 1 : 0})
      on conflict (
        day, type,
        coalesce(store_id, ${NIL}::uuid),
        coalesce(product_id, ${NIL}::uuid),
        coalesce(variant_id, ${NIL}::uuid)
      )
      do update set
        events = analytics_daily.events + 1,
        sessions = analytics_daily.sessions + ${firstOfSession ? 1 : 0}
    `);
  }

  return { written: rows.length };
}

/**
 * Deletes raw events past the retention window.
 *
 * The counters are not touched — they are the history. This only drops the
 * per-event detail, which exists for looking into a number that seems wrong and
 * stops being useful long before it stops being expensive.
 */
export async function sweepAnalyticsEvents(
  retentionDays = 14,
): Promise<{ deleted: number }> {
  const result = await db.execute<{ count: string }>(sql`
    with gone as (
      delete from analytics_events
      where occurred_at < now() - make_interval(days => ${retentionDays})
      returning 1
    )
    select count(*)::text from gone
  `);

  // Session claims expire with them; a claim for a past day can never be hit.
  await db.execute(sql`
    delete from analytics_daily_sessions
    where day < (now() at time zone ${SHOP_TIME_ZONE})::date - ${retentionDays}
  `);

  return { deleted: Number(result[0]?.count ?? 0) };
}
