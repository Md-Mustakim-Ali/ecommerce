import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * Analytics reads.
 *
 * Two rules run through all of these.
 *
 * First, every time series is dense. The daily aggregates are built from a
 * `generate_series` left-joined to the data, so a day with no orders is a zero
 * rather than a missing row. A gappy series silently breaks every model
 * downstream: a moving average averages the wrong window, a seasonal index is
 * assigned to the wrong weekday, and a forecast is confidently wrong.
 *
 * Second, cancelled and refunded money is excluded from revenue but kept
 * available separately. Netting refunds into the revenue line hides the return
 * rate, which is usually the more actionable number.
 */

export type DailyPoint = {
  day: string;
  revenueCents: number;
  orders: number;
  units: number;
};

/** Dense daily revenue and order counts for one store. */
export async function dailySeriesForStore(
  storeId: string,
  days = 180,
): Promise<DailyPoint[]> {
  const rows = await db.execute<{
    day: string;
    revenue_cents: string;
    orders: string;
    units: string;
  }>(sql`
    with span as (
      select generate_series(
        (current_date - make_interval(days => ${days - 1})),
        current_date,
        interval '1 day'
      )::date as day
    ),
    -- One row per sub-order. Units are rolled up in a subquery rather than by
    -- joining order_items here: the gross sits on the sub-order, so a join to
    -- its lines would multiply the revenue by the number of lines.
    live as (
      select
        date_trunc('day', o.placed_at)::date as day,
        so.id,
        so.subtotal_cents + so.shipping_cents as gross,
        (select coalesce(sum(oi.quantity), 0)
           from order_items oi where oi.sub_order_id = so.id) as units
      from sub_orders so
      join orders o on o.id = so.order_id
      where so.store_id = ${storeId}
        and so.status not in ('cancelled', 'refunded')
        and o.placed_at is not null
    )
    select
      span.day::text as day,
      coalesce(sum(live.gross), 0)::text as revenue_cents,
      coalesce(count(live.id), 0)::text as orders,
      coalesce(sum(live.units), 0)::text as units
    from span
    left join live on live.day = span.day
    group by span.day
    order by span.day
  `);

  return rows.map((row) => ({
    day: row.day,
    revenueCents: Number(row.revenue_cents),
    orders: Number(row.orders),
    units: Number(row.units),
  }));
}

/** Dense daily revenue across the whole platform, with commission. */
export async function dailySeriesForPlatform(
  days = 180,
): Promise<(DailyPoint & { commissionCents: number; stores: number })[]> {
  const rows = await db.execute<{
    day: string;
    revenue_cents: string;
    commission_cents: string;
    orders: string;
    units: string;
    stores: string;
  }>(sql`
    with span as (
      select generate_series(
        (current_date - make_interval(days => ${days - 1})),
        current_date,
        interval '1 day'
      )::date as day
    ),
    subs as (
      select
        date_trunc('day', o.placed_at)::date as day,
        so.id,
        so.store_id,
        so.subtotal_cents + so.shipping_cents as gross,
        so.commission_cents,
        (select coalesce(sum(oi.quantity), 0)
           from order_items oi where oi.sub_order_id = so.id) as units
      from sub_orders so
      join orders o on o.id = so.order_id
      where so.status not in ('cancelled', 'refunded')
        and o.placed_at is not null
    )
    select
      span.day::text as day,
      coalesce(sum(subs.gross), 0)::text as revenue_cents,
      coalesce(sum(subs.commission_cents), 0)::text as commission_cents,
      coalesce(count(subs.id), 0)::text as orders,
      coalesce(sum(subs.units), 0)::text as units,
      coalesce(count(distinct subs.store_id), 0)::text as stores
    from span
    left join subs on subs.day = span.day
    group by span.day
    order by span.day
  `);

  return rows.map((row) => ({
    day: row.day,
    revenueCents: Number(row.revenue_cents),
    commissionCents: Number(row.commission_cents),
    orders: Number(row.orders),
    units: Number(row.units),
    stores: Number(row.stores),
  }));
}

/** Per-order gross for a store, so an average order value can carry an interval. */
export async function orderValuesForStore(
  storeId: string,
  days = 90,
): Promise<number[]> {
  const rows = await db.execute<{ gross: string }>(sql`
    select (so.subtotal_cents + so.shipping_cents)::text as gross
    from sub_orders so
    join orders o on o.id = so.order_id
    where so.store_id = ${storeId}
      and so.status not in ('cancelled', 'refunded')
      and o.placed_at >= current_date - make_interval(days => ${days})
  `);
  return rows.map((row) => Number(row.gross));
}

export type ProductPerformance = {
  productId: string;
  title: string;
  slug: string;
  revenueCents: number;
  units: number;
  orders: number;
  ratingAverage: number | null;
  ratingCount: number;
};

/** Revenue by product, which feeds the concentration measures. */
export async function productPerformance(
  storeId: string,
  days = 180,
): Promise<ProductPerformance[]> {
  const rows = await db.execute<{
    product_id: string;
    title: string;
    slug: string;
    revenue_cents: string;
    units: string;
    orders: string;
    rating_avg: string | null;
    rating_count: string;
  }>(sql`
    -- Windowed in a CTE for the same reason as storePerformance: the date test
    -- on a LEFT JOIN nulls the joined row without excluding the line, so the
    -- revenue would quietly cover all time.
    with sold as (
      select oi.variant_id, oi.line_total_cents, oi.quantity, so.id as sub_order_id
      from order_items oi
      join sub_orders so on so.id = oi.sub_order_id
      join orders o on o.id = so.order_id
      where so.status not in ('cancelled', 'refunded')
        and o.placed_at >= current_date - make_interval(days => ${days})
    )
    select
      p.id as product_id,
      p.title,
      p.slug,
      coalesce(sum(sold.line_total_cents), 0)::text as revenue_cents,
      coalesce(sum(sold.quantity), 0)::text as units,
      count(distinct sold.sub_order_id)::text as orders,
      (select round(avg(r.rating)::numeric, 2)::text
         from reviews r where r.product_id = p.id and r.status = 'published') as rating_avg,
      (select count(*) from reviews r
        where r.product_id = p.id and r.status = 'published')::text as rating_count
    from products p
    left join product_variants pv on pv.product_id = p.id
    left join sold on sold.variant_id = pv.id
    where p.store_id = ${storeId}
    group by p.id, p.title, p.slug
    order by 4 desc
  `);

  return rows.map((row) => ({
    productId: row.product_id,
    title: row.title,
    slug: row.slug,
    revenueCents: Number(row.revenue_cents),
    units: Number(row.units),
    orders: Number(row.orders),
    ratingAverage: row.rating_avg === null ? null : Number(row.rating_avg),
    ratingCount: Number(row.rating_count),
  }));
}

/**
 * Daily units sold per variant, for the inventory model.
 *
 * Returned as a dense per-variant series so demand variance is computed over
 * every day including the zeroes. Averaging only the days something sold
 * overstates demand badly for slow movers — which are exactly the items whose
 * reorder point is hardest to get right.
 */
export async function variantDemand(
  storeId: string,
  days = 60,
): Promise<
  {
    variantId: string;
    productTitle: string;
    sku: string | null;
    stock: number;
    daily: number[];
  }[]
> {
  const rows = await db.execute<{
    variant_id: string;
    title: string;
    sku: string | null;
    stock: number;
    daily: string;
  }>(sql`
    with span as (
      select generate_series(
        (current_date - make_interval(days => ${days - 1})),
        current_date,
        interval '1 day'
      )::date as day
    ),
    sold as (
      select
        oi.variant_id,
        date_trunc('day', o.placed_at)::date as day,
        sum(oi.quantity) as units
      from order_items oi
      join sub_orders so on so.id = oi.sub_order_id
      join orders o on o.id = so.order_id
      where so.store_id = ${storeId}
        and so.status not in ('cancelled', 'refunded')
        and o.placed_at >= current_date - make_interval(days => ${days - 1})
      group by 1, 2
    )
    select
      pv.id as variant_id,
      p.title,
      pv.sku,
      pv.stock,
      json_agg(coalesce(sold.units, 0) order by span.day)::text as daily
    from product_variants pv
    join products p on p.id = pv.product_id
    cross join span
    left join sold on sold.variant_id = pv.id and sold.day = span.day
    where p.store_id = ${storeId}
    group by pv.id, p.title, pv.sku, pv.stock
    -- Only variants that actually move; a reorder point for something that has
    -- never sold is noise on the screen.
    having sum(coalesce(sold.units, 0)) > 0
    order by sum(coalesce(sold.units, 0)) desc
    limit 40
  `);

  return rows.map((row) => ({
    variantId: row.variant_id,
    productTitle: row.title,
    sku: row.sku,
    stock: row.stock,
    daily: JSON.parse(row.daily) as number[],
  }));
}

/** Rating histogram for a store, for the Bayesian-adjusted score. */
export async function ratingSummaryForStore(storeId: string) {
  const rows = await db.execute<{ rating: number; count: string }>(sql`
    select r.rating, count(*)::text as count
    from reviews r
    join products p on p.id = r.product_id
    where p.store_id = ${storeId} and r.status = 'published'
    group by r.rating
    order by r.rating desc
  `);

  const byRating = new Map(
    rows.map((r) => [Number(r.rating), Number(r.count)]),
  );
  const buckets = [5, 4, 3, 2, 1].map((rating) => ({
    rating,
    count: byRating.get(rating) ?? 0,
  }));
  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  const sum = buckets.reduce((acc, b) => acc + b.rating * b.count, 0);

  return { buckets, total, sum, average: total === 0 ? null : sum / total };
}

/** The platform-wide mean rating, used as the prior for shrinkage. */
export async function platformRatingPrior(): Promise<number> {
  const rows = await db.execute<{ avg: string | null }>(sql`
    select avg(rating)::text as avg from reviews where status = 'published'
  `);
  const value = rows[0]?.avg;
  // 4.0 is a reasonable default before any reviews exist; it only matters for
  // a brand-new platform, where nothing is being ranked yet anyway.
  return value === null || value === undefined ? 4 : Number(value);
}

/** Repeat-purchase counts, so the rate can carry a Wilson interval. */
export async function repeatPurchaseForStore(storeId: string, days = 365) {
  const rows = await db.execute<{ buyers: string; repeat_buyers: string }>(sql`
    with per_buyer as (
      select o.buyer_id, count(distinct so.id) as orders
      from sub_orders so
      join orders o on o.id = so.order_id
      where so.store_id = ${storeId}
        and so.status not in ('cancelled', 'refunded')
        and o.buyer_id is not null
        and o.placed_at >= current_date - make_interval(days => ${days})
      group by o.buyer_id
    )
    select
      count(*)::text as buyers,
      count(*) filter (where orders > 1)::text as repeat_buyers
    from per_buyer
  `);

  return {
    buyers: Number(rows[0]?.buyers ?? 0),
    repeatBuyers: Number(rows[0]?.repeat_buyers ?? 0),
  };
}

export type StorePerformance = {
  storeId: string;
  name: string;
  slug: string;
  revenueCents: number;
  commissionCents: number;
  orders: number;
  ratingAverage: number | null;
  ratingCount: number;
};

/** Per-store totals, which feed the platform concentration measures. */
export async function storePerformance(
  days = 180,
): Promise<StorePerformance[]> {
  const rows = await db.execute<{
    store_id: string;
    name: string;
    slug: string;
    revenue_cents: string;
    commission_cents: string;
    orders: string;
    rating_avg: string | null;
    rating_count: string;
  }>(sql`
    -- The window is applied here, in a CTE, rather than as an extra condition
    -- on a LEFT JOIN to orders. On a left join that condition does not exclude
    -- anything: it only nulls the joined row, and the sub-order survives with
    -- its revenue intact, so the query silently reports all time.
    with qualifying as (
      select so.store_id, so.id,
             so.subtotal_cents + so.shipping_cents as gross,
             so.commission_cents
      from sub_orders so
      join orders o on o.id = so.order_id
      where so.status not in ('cancelled', 'refunded')
        and o.placed_at >= current_date - make_interval(days => ${days})
    )
    select
      s.id as store_id,
      s.name,
      s.slug,
      coalesce(sum(q.gross), 0)::text as revenue_cents,
      coalesce(sum(q.commission_cents), 0)::text as commission_cents,
      count(q.id)::text as orders,
      (select round(avg(r.rating)::numeric, 2)::text
         from reviews r join products p on p.id = r.product_id
        where p.store_id = s.id and r.status = 'published') as rating_avg,
      (select count(*) from reviews r join products p on p.id = r.product_id
        where p.store_id = s.id and r.status = 'published')::text as rating_count
    from stores s
    left join qualifying q on q.store_id = s.id
    group by s.id, s.name, s.slug
    order by 4 desc
  `);

  return rows.map((row) => ({
    storeId: row.store_id,
    name: row.name,
    slug: row.slug,
    revenueCents: Number(row.revenue_cents),
    commissionCents: Number(row.commission_cents),
    orders: Number(row.orders),
    ratingAverage: row.rating_avg === null ? null : Number(row.rating_avg),
    ratingCount: Number(row.rating_count),
  }));
}

/** Where orders currently sit, for the fulfilment funnel. */
export async function statusBreakdown(storeId?: string) {
  const rows = await db.execute<{
    status: string;
    count: string;
    gross: string;
  }>(sql`
    select
      so.status::text as status,
      count(*)::text as count,
      coalesce(sum(so.subtotal_cents + so.shipping_cents), 0)::text as gross
    from sub_orders so
    join orders o on o.id = so.order_id
    where o.placed_at >= current_date - interval '90 days'
      ${storeId ? sql`and so.store_id = ${storeId}` : sql``}
    group by so.status
  `);

  return rows.map((row) => ({
    status: row.status,
    count: Number(row.count),
    grossCents: Number(row.gross),
  }));
}

/** Revenue by top-level category, for the platform mix. */
export async function categoryPerformance(days = 180) {
  const rows = await db.execute<{
    name: string;
    revenue_cents: string;
    units: string;
  }>(sql`
    with roots as (
      select c.id, c.name
      from categories c
      where c.parent_id is null
    ),
    -- Walks each product's category up to its root, so a sale on a deep leaf
    -- counts toward the top-level bucket a person actually thinks in.
    lineage as (
      select c.id as category_id, coalesce(r.id, c.id) as root_id,
             coalesce(r.name, c.name) as root_name
      from categories c
      left join lateral (
        with recursive up as (
          select c2.id, c2.parent_id, c2.name from categories c2 where c2.id = c.id
          union all
          select p.id, p.parent_id, p.name from categories p join up on up.parent_id = p.id
        )
        select id, name from up where parent_id is null limit 1
      ) r on true
    )
    select
      lineage.root_name as name,
      coalesce(sum(oi.line_total_cents), 0)::text as revenue_cents,
      coalesce(sum(oi.quantity), 0)::text as units
    from order_items oi
    join sub_orders so on so.id = oi.sub_order_id
      and so.status not in ('cancelled', 'refunded')
    join orders o on o.id = so.order_id
      and o.placed_at >= current_date - make_interval(days => ${days})
    join product_variants pv on pv.id = oi.variant_id
    join products p on p.id = pv.product_id
    join lineage on lineage.category_id = p.category_id
    group by lineage.root_name
    order by 2 desc
  `);

  return rows.map((row) => ({
    name: row.name,
    revenueCents: Number(row.revenue_cents),
    units: Number(row.units),
  }));
}

/** Refund rate over the window, so it can carry an interval. */
export async function refundCounts(storeId?: string, days = 180) {
  const rows = await db.execute<{ total: string; refunded: string }>(sql`
    select
      count(*)::text as total,
      count(*) filter (where so.status in ('refunded', 'cancelled'))::text as refunded
    from sub_orders so
    join orders o on o.id = so.order_id
    where o.placed_at >= current_date - make_interval(days => ${days})
      ${storeId ? sql`and so.store_id = ${storeId}` : sql``}
  `);

  return {
    total: Number(rows[0]?.total ?? 0),
    refunded: Number(rows[0]?.refunded ?? 0),
  };
}
