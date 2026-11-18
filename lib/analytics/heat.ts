import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * Heat: what is in demand, broken down by whatever dimension you ask for.
 *
 * ── What this can and cannot see ─────────────────────────────────────────
 *
 * Everything here is derived from things buyers actually *did* — ordered,
 * saved, put in a basket, sent back. Nothing records what they looked at,
 * hovered over or clicked away from, because no such data exists: this
 * application has never had an events table, and inventing numbers for views
 * would be worse than admitting they are missing.
 *
 * That gap is smaller than it sounds. The closest thing to "wanted it but did
 * not buy" is a basket that never became an order, and that is recorded
 * exactly — see `intentHeat`. It is a stronger signal than a page view anyway:
 * putting something in a basket is a decision, and looking at a page is not.
 *
 * ── Why a matrix and not a chart ─────────────────────────────────────────
 *
 * A line per product is unreadable past about six products. A grid of rows and
 * weeks stays readable at fifty, and answers the question a seller actually
 * asks — "which of my things are moving, and when" — in one look.
 *
 * Colour carries magnitude, which is the one job a sequential ramp is for. The
 * number is printed in the cell as well, because colour alone is not readable
 * to everyone and "slightly darker blue" is not a quantity.
 */

/** One dimension a store's demand can be sliced by. */
export type HeatDimension = "product" | "variant" | "category" | "tag";

export type HeatMatrix = {
  dimension: HeatDimension;
  /** Rows, hottest first. Capped, because a grid nobody scrolls is a table. */
  rows: { key: string; label: string; total: number }[];
  /** Column keys in chronological order — ISO dates of each week's Monday. */
  cols: string[];
  /** `${rowKey}|${col}` → units. Absent means zero; a sparse grid is normal. */
  cells: Record<string, number>;
  /** The busiest single cell, which is what the ramp is scaled against. */
  peak: number;
};

/**
 * Demand over time, by dimension.
 *
 * Units rather than revenue, deliberately. Revenue conflates "sells a lot" with
 * "is expensive", and a seller looking at a heat map is asking about movement —
 * what to reorder, what to photograph better, what to stop making.
 *
 * Cancelled and refunded parts are excluded: they are not demand, they are the
 * absence of it, and counting them would make a product that everybody returns
 * look like a hit.
 */
export async function demandHeat(
  storeId: string,
  dimension: HeatDimension,
  weeks = 12,
  limit = 25,
): Promise<HeatMatrix> {
  /*
    The dimension only changes what we group by and what we call it. The join
    to order_items, the store filter and the time window are identical, so they
    are written once — four near-identical queries is four places for the store
    filter to be wrong in one of them.

    Note that product and variant labels come from the ORDER's snapshot columns,
    not from the live catalogue, so a renamed product still reads as what it was
    called when it sold. Category and tag have no snapshot and must join live.
  */
  const grouped = {
    product: {
      key: sql`coalesce(pv.product_id::text, oi.product_title)`,
      label: sql`max(oi.product_title)`,
      join: sql`left join product_variants pv on pv.id = oi.variant_id`,
    },
    variant: {
      key: sql`coalesce(oi.variant_id::text, oi.product_title || ' ' || coalesce(oi.variant_label, ''))`,
      // `nullif` as well as the null check: an unlabelled variant stores an
      // empty string rather than null, which rendered a trailing separator
      // with nothing after it.
      label: sql`max(oi.product_title || coalesce(' · ' || nullif(btrim(oi.variant_label), ''), ''))`,
      join: sql``,
    },
    category: {
      key: sql`c.id::text`,
      label: sql`max(c.name)`,
      join: sql`
        left join product_variants pv on pv.id = oi.variant_id
        left join products p on p.id = pv.product_id
        left join categories c on c.id = p.category_id`,
    },
    tag: {
      key: sql`t.id::text`,
      label: sql`max(t.name)`,
      join: sql`
        left join product_variants pv on pv.id = oi.variant_id
        left join product_tags pt on pt.product_id = pv.product_id
        left join tags t on t.id = pt.tag_id`,
    },
  }[dimension];

  const rows = await db.execute<{
    row_key: string | null;
    row_label: string | null;
    week: string;
    units: string;
  }>(sql`
    select
      ${grouped.key} as row_key,
      ${grouped.label} as row_label,
      to_char(date_trunc('week', o.placed_at), 'YYYY-MM-DD') as week,
      sum(oi.quantity)::text as units
    from order_items oi
    join sub_orders so on so.id = oi.sub_order_id
    join orders o on o.id = so.order_id
    ${grouped.join}
    where so.store_id = ${storeId}
      and so.status not in ('cancelled', 'refunded')
      and o.status <> 'unconfirmed'
      and o.placed_at >= date_trunc('week', current_date) - make_interval(weeks => ${weeks - 1})
    group by 1, 3
    having ${grouped.key} is not null
    order by 3
  `);

  return toMatrix(dimension, rows, weeks, limit);
}

/**
 * Intent versus purchase, per product.
 *
 * The closest thing to "people wanted this and did not buy it" that honest data
 * can produce. Four stages, each counted from its own table:
 *
 *   Saved     — on a wishlist right now (`saved_items`)
 *   Basketed  — put in a basket, ever (`cart_items`, including guests' baskets)
 *   Ordered   — units actually bought
 *   Returned  — refund requests raised
 *
 * ── The scaling decision, which changes what it means ────────────────────
 *
 * The four columns are scaled independently, each against its own busiest
 * value. They have to be: baskets outnumber orders several times over, so a
 * shared scale would render every "ordered" cell nearly blank and the map would
 * say nothing except "more things go in baskets than get bought", which
 * everybody already knows.
 *
 * What it does say, read across a row: a product bright under Basketed and dark
 * under Ordered is one people keep choosing and then not buying — a price, a
 * delivery estimate or a photograph problem. Bright under Ordered and bright
 * under Returned is worse: it sells and comes back.
 */
export type IntentStage = "saved" | "basketed" | "ordered" | "returned";

export type IntentHeat = {
  rows: { key: string; label: string; counts: Record<IntentStage, number> }[];
  /** Per-stage maxima, because the stages are not on one scale. */
  peaks: Record<IntentStage, number>;
};

export async function intentHeat(
  storeId: string,
  days = 90,
  limit = 25,
): Promise<IntentHeat> {
  const rows = await db.execute<{
    product_id: string;
    title: string;
    saved: string;
    basketed: string;
    ordered: string;
    returned: string;
  }>(sql`
    with mine as (
      select p.id, p.title
      from products p
      where p.store_id = ${storeId}
    ),
    saved as (
      select si.product_id, count(*)::int n
      from saved_items si join mine on mine.id = si.product_id
      group by 1
    ),
    basketed as (
      -- Distinct baskets, not units: one person adding six of something is one
      -- act of wanting it, and counting quantity would let a single bulk buyer
      -- outshine genuine interest from twenty people.
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
      where so.store_id = ${storeId}
        and so.status not in ('cancelled', 'refunded')
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
      where so.store_id = ${storeId}
        and rr.created_at >= current_date - make_interval(days => ${days - 1})
      group by 1
    )
    select
      mine.id::text as product_id,
      mine.title as title,
      coalesce(saved.n, 0)::text as saved,
      coalesce(basketed.n, 0)::text as basketed,
      coalesce(ordered.n, 0)::text as ordered,
      coalesce(returned.n, 0)::text as returned
    from mine
    left join saved on saved.product_id = mine.id
    left join basketed on basketed.product_id = mine.id
    left join ordered on ordered.product_id = mine.id
    left join returned on returned.product_id = mine.id
    -- A product nobody has touched at all is not interesting; it is noise.
    where coalesce(saved.n, 0) + coalesce(basketed.n, 0)
        + coalesce(ordered.n, 0) + coalesce(returned.n, 0) > 0
    order by coalesce(basketed.n, 0) + coalesce(ordered.n, 0) desc
    limit ${limit}
  `);

  const peaks: Record<IntentStage, number> = {
    saved: 0,
    basketed: 0,
    ordered: 0,
    returned: 0,
  };

  const mapped = rows.map((row) => {
    const counts: Record<IntentStage, number> = {
      saved: Number(row.saved),
      basketed: Number(row.basketed),
      ordered: Number(row.ordered),
      returned: Number(row.returned),
    };
    for (const stage of Object.keys(peaks) as IntentStage[]) {
      peaks[stage] = Math.max(peaks[stage], counts[stage]);
    }
    return { key: row.product_id, label: row.title, counts };
  });

  return { rows: mapped, peaks };
}

/** Shapes the flat SQL result into the grid the component draws. */
function toMatrix(
  dimension: HeatDimension,
  rows: {
    row_key: string | null;
    row_label: string | null;
    week: string;
    units: string;
  }[],
  weeks: number,
  limit: number,
): HeatMatrix {
  const totals = new Map<string, { label: string; total: number }>();
  const cells: Record<string, number> = {};

  for (const row of rows) {
    if (!row.row_key) continue;
    const units = Number(row.units);
    const existing = totals.get(row.row_key);
    totals.set(row.row_key, {
      label: row.row_label ?? existing?.label ?? "Unknown",
      total: (existing?.total ?? 0) + units,
    });
    cells[`${row.row_key}|${row.week}`] = units;
  }

  const ranked = [...totals.entries()]
    .map(([key, value]) => ({ key, label: value.label, total: value.total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);

  /*
    Columns are generated rather than taken from the rows, so a week where this
    store sold nothing still appears. A grid that silently omits empty weeks
    draws a continuous run of activity over a gap, which is the opposite of what
    the reader needs to see.
  */
  const cols: string[] = [];
  const monday = startOfWeek(new Date());
  for (let index = weeks - 1; index >= 0; index -= 1) {
    const day = new Date(monday);
    day.setUTCDate(day.getUTCDate() - index * 7);
    cols.push(day.toISOString().slice(0, 10));
  }

  const keep = new Set(ranked.map((row) => row.key));
  const peak = Object.entries(cells).reduce(
    (max, [key, value]) =>
      keep.has(key.slice(0, key.lastIndexOf("|"))) ? Math.max(max, value) : max,
    0,
  );

  return { dimension, rows: ranked, cols, cells, peak };
}

/** Monday, in UTC, matching Postgres's `date_trunc('week', …)`. */
function startOfWeek(date: Date): Date {
  const copy = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  // getUTCDay: 0 is Sunday, and Postgres weeks start on Monday.
  const shift = (copy.getUTCDay() + 6) % 7;
  copy.setUTCDate(copy.getUTCDate() - shift);
  return copy;
}
