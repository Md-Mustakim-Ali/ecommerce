import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { type HeatMatrix, toMatrix } from "./heat";

/**
 * Heat from what people did before deciding — now that it is recorded.
 *
 * ── Reads the counter, never the raw stream ──────────────────────────────
 *
 * `analytics_daily` is the history here. Raw events are swept after a
 * fortnight and these grids show a quarter, so aggregating on read would draw
 * a chart that silently loses its own past — and would scan every view the shop
 * has ever served, on a database that bills for compute, to draw one page.
 *
 * The one exception is search terms, which have nowhere else to live: the term
 * is in the event's `meta` and would need a column of its own to be counted
 * daily. That query is therefore bounded to the retention window, and says so.
 */

/** Behaviour recorded against a product. */
export type BehaviourType =
  | "product_view"
  | "product_click"
  | "ui_click"
  | "add_to_cart"
  | "wishlist_add";

/**
 * Behaviour by product and week.
 *
 * Counts sessions rather than events by default, because that is the honest
 * number: one person refreshing six times is not six people, and a seller
 * reading "6 views" would believe it was. Events answer a different question —
 * how hard somebody is working at a decision — so both are available.
 *
 * `storeId` of null is the platform view; the queries are otherwise identical,
 * which is the point of passing it rather than writing an admin copy.
 */
export async function behaviourHeat(
  storeId: string | null,
  type: BehaviourType,
  weeks = 12,
  limit = 25,
  measure: "sessions" | "events" = "sessions",
): Promise<HeatMatrix> {
  const rows = await db.execute<{
    row_key: string | null;
    row_label: string | null;
    week: string;
    units: string;
  }>(sql`
    select
      d.product_id::text as row_key,
      max(p.title) as row_label,
      to_char(date_trunc('week', d.day), 'YYYY-MM-DD') as week,
      sum(${measure === "sessions" ? sql`d.sessions` : sql`d.events`})::text as units
    from analytics_daily d
    join products p on p.id = d.product_id
    where d.type = ${type}
      and d.product_id is not null
      ${storeId ? sql`and d.store_id = ${storeId}` : sql``}
      and d.day >= date_trunc('week', current_date) - make_interval(weeks => ${weeks - 1})
    group by 1, 3
    order by 3
  `);

  return toMatrix("product", rows, weeks, limit);
}

/**
 * The funnel, in the order a shopper meets it.
 *
 * A row reads left to right as a story: seen by forty, basketed by six, bought
 * by one. Where the drop happens says which problem it is — a listing nobody
 * baskets is a photograph or a price, and one everybody baskets and nobody buys
 * is a delivery estimate or a checkout.
 *
 * Columns are scaled independently and the UI says so. They have to be: views
 * dwarf orders by an order of magnitude, so a shared scale would render every
 * "ordered" cell blank and claim nothing was ever sold.
 */
export type FunnelStage =
  | "viewed"
  | "basketed"
  | "ordered"
  | "returned"
  | "reported";

export type FunnelHeat = {
  rows: { key: string; label: string; counts: Record<FunnelStage, number> }[];
  peaks: Record<FunnelStage, number>;
};

export async function funnelHeat(
  storeId: string | null,
  days = 90,
  limit = 25,
): Promise<FunnelHeat> {
  const scope = storeId ? sql`and p.store_id = ${storeId}` : sql``;

  const rows = await db.execute<{
    product_id: string;
    title: string;
    viewed: string;
    basketed: string;
    ordered: string;
    returned: string;
    reported: string;
  }>(sql`
    with mine as (
      select p.id, p.title from products p where true ${scope}
    ),
    viewed as (
      select d.product_id, sum(d.sessions)::int n
      from analytics_daily d join mine on mine.id = d.product_id
      where d.type = 'product_view'
        and d.day >= current_date - make_interval(days => ${days - 1})
      group by 1
    ),
    basketed as (
      -- Distinct baskets, not units: one person adding six is one act of
      -- wanting it, and counting quantity lets a bulk buyer outshine twenty
      -- people who were interested.
      select pv.product_id, count(distinct ci.cart_id)::int n
      from cart_items ci
      join product_variants pv on pv.id = ci.variant_id
      join mine on mine.id = pv.product_id
      where ci.added_at >= current_date - make_interval(days => ${days - 1})
      group by 1
    ),
    ordered as (
      select pv.product_id, sum(oi.quantity)::int n
      from order_items oi
      join sub_orders so on so.id = oi.sub_order_id
      join orders o on o.id = so.order_id
      join product_variants pv on pv.id = oi.variant_id
      join mine on mine.id = pv.product_id
      where so.status not in ('cancelled', 'refunded')
        and o.status <> 'unconfirmed'
        and o.placed_at >= current_date - make_interval(days => ${days - 1})
      group by 1
    ),
    returned as (
      select pv.product_id, count(distinct rr.id)::int n
      from refund_requests rr
      join sub_orders so on so.id = rr.sub_order_id
      join order_items oi on oi.sub_order_id = so.id
      join product_variants pv on pv.id = oi.variant_id
      join mine on mine.id = pv.product_id
      where rr.created_at >= current_date - make_interval(days => ${days - 1})
      group by 1
    ),
    reported as (
      select r.product_id, count(*)::int n
      from reports r join mine on mine.id = r.product_id
      where r.created_at >= current_date - make_interval(days => ${days - 1})
      group by 1
    )
    select
      mine.id::text as product_id,
      mine.title,
      coalesce(viewed.n, 0)::text as viewed,
      coalesce(basketed.n, 0)::text as basketed,
      coalesce(ordered.n, 0)::text as ordered,
      coalesce(returned.n, 0)::text as returned,
      coalesce(reported.n, 0)::text as reported
    from mine
    left join viewed on viewed.product_id = mine.id
    left join basketed on basketed.product_id = mine.id
    left join ordered on ordered.product_id = mine.id
    left join returned on returned.product_id = mine.id
    left join reported on reported.product_id = mine.id
    where coalesce(viewed.n,0) + coalesce(basketed.n,0) + coalesce(ordered.n,0)
        + coalesce(returned.n,0) + coalesce(reported.n,0) > 0
    order by coalesce(viewed.n,0) + coalesce(ordered.n,0) * 5 desc
    limit ${limit}
  `);

  const peaks: Record<FunnelStage, number> = {
    viewed: 0,
    basketed: 0,
    ordered: 0,
    returned: 0,
    reported: 0,
  };

  const mapped = rows.map((row) => {
    const counts: Record<FunnelStage, number> = {
      viewed: Number(row.viewed),
      basketed: Number(row.basketed),
      ordered: Number(row.ordered),
      returned: Number(row.returned),
      reported: Number(row.reported),
    };
    for (const stage of Object.keys(peaks) as FunnelStage[]) {
      peaks[stage] = Math.max(peaks[stage], counts[stage]);
    }
    return { key: row.product_id, label: row.title, counts };
  });

  return { rows: mapped, peaks };
}

/**
 * What people typed into search.
 *
 * Platform-wide only. A search belongs to no store, and attributing one to
 * whichever seller happened to rank in the results would be inventing a fact.
 *
 * Bounded by the raw retention window rather than by the requested range,
 * because the term lives in the event's `meta` and is not rolled up daily. The
 * caller is told the effective window rather than left to assume.
 */
export async function searchHeat(days = 14, limit = 25) {
  const rows = await db.execute<{
    term: string;
    searches: string;
    people: string;
  }>(sql`
    select
      lower(btrim(e.meta ->> 'q')) as term,
      count(*)::text as searches,
      count(distinct e.session_id)::text as people
    from analytics_events e
    where e.type = 'search'
      and e.occurred_at >= current_date - make_interval(days => ${days - 1})
      and nullif(btrim(e.meta ->> 'q'), '') is not null
    group by 1
    order by count(distinct e.session_id) desc, count(*) desc
    limit ${limit}
  `);

  return rows.map((row) => ({
    term: row.term,
    searches: Number(row.searches),
    people: Number(row.people),
  }));
}

/**
 * Which controls people actually press.
 *
 * Opt-in: only elements carrying `data-track` are counted, so this is a list of
 * things somebody decided were worth measuring rather than every node in the
 * document. A global click recorder produces a table nobody reads.
 */
export async function clickHeat(storeId: string | null, days = 30, limit = 25) {
  const rows = await db.execute<{
    label: string;
    clicks: string;
    people: string;
  }>(sql`
    select
      e.label,
      count(*)::text as clicks,
      count(distinct e.session_id)::text as people
    from analytics_events e
    where e.type = 'ui_click'
      and e.label is not null
      ${storeId ? sql`and e.store_id = ${storeId}` : sql``}
      and e.occurred_at >= current_date - make_interval(days => ${days - 1})
    group by 1
    order by count(*) desc
    limit ${limit}
  `);

  return rows.map((row) => ({
    label: row.label,
    clicks: Number(row.clicks),
    people: Number(row.people),
  }));
}
