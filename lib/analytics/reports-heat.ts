import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * Complaints, counted.
 *
 * Store-scoped for a seller — their own products and reviews, never anyone
 * else's — and unscoped for an admin, who also needs the per-seller view that
 * answers "which shop attracts trouble".
 */

export type ReportedProduct = {
  productId: string | null;
  label: string;
  total: number;
  open: number;
  upheld: number;
  /** Reason → count, so a row says what kind of trouble it is. */
  reasons: Record<string, number>;
};

export async function reportedProducts(
  storeId: string | null,
  days = 180,
  limit = 25,
): Promise<ReportedProduct[]> {
  const rows = await db.execute<{
    product_id: string | null;
    label: string | null;
    reason: string;
    n: string;
    open_n: string;
    upheld_n: string;
  }>(sql`
    select
      r.product_id::text as product_id,
      coalesce(max(p.title), max(s.name)) as label,
      r.reason::text as reason,
      count(*)::text as n,
      count(*) filter (where r.status in ('open','reviewing'))::text as open_n,
      count(*) filter (where r.status = 'upheld')::text as upheld_n
    from reports r
    left join products p on p.id = r.product_id
    left join stores s on s.id = r.store_id
    where r.created_at >= current_date - make_interval(days => ${days - 1})
      ${storeId ? sql`and r.store_id = ${storeId}` : sql``}
    group by r.product_id, r.reason
  `);

  const byProduct = new Map<string, ReportedProduct>();

  for (const row of rows) {
    // Reports against the store itself have no product; they group together.
    const key = row.product_id ?? "store";
    const existing = byProduct.get(key) ?? {
      productId: row.product_id,
      label: row.label ?? "The store itself",
      total: 0,
      open: 0,
      upheld: 0,
      reasons: {},
    };

    existing.total += Number(row.n);
    existing.open += Number(row.open_n);
    existing.upheld += Number(row.upheld_n);
    existing.reasons[row.reason] =
      (existing.reasons[row.reason] ?? 0) + Number(row.n);

    byProduct.set(key, existing);
  }

  return [...byProduct.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

/**
 * Which sellers attract complaints. Platform only.
 *
 * Ranked on upheld, not on raw volume. A busy shop attracts complaints the way
 * a busy road attracts litter, and ordering by total would pin the largest
 * seller to the top of this list for ever regardless of whether they had done
 * anything wrong. Upheld is the count somebody looked at and agreed with.
 */
export async function reportedStores(days = 180, limit = 25) {
  const rows = await db.execute<{
    store_id: string;
    name: string;
    total: string;
    open_n: string;
    upheld_n: string;
    dismissed_n: string;
  }>(sql`
    select
      s.id::text as store_id,
      s.name,
      count(*)::text as total,
      count(*) filter (where r.status in ('open','reviewing'))::text as open_n,
      count(*) filter (where r.status = 'upheld')::text as upheld_n,
      count(*) filter (where r.status = 'dismissed')::text as dismissed_n
    from reports r
    join stores s on s.id = r.store_id
    where r.created_at >= current_date - make_interval(days => ${days - 1})
    group by 1, 2
    order by count(*) filter (where r.status = 'upheld') desc, count(*) desc
    limit ${limit}
  `);

  return rows.map((row) => ({
    storeId: row.store_id,
    name: row.name,
    total: Number(row.total),
    open: Number(row.open_n),
    upheld: Number(row.upheld_n),
    dismissed: Number(row.dismissed_n),
  }));
}

/** The admin queue: open reports, oldest first, with enough to judge them. */
export async function openReports(limit = 50) {
  const rows = await db.execute<{
    id: string;
    target_type: string;
    target_id: string;
    store_id: string;
    store_name: string;
    product_title: string | null;
    reason: string;
    detail: string | null;
    status: string;
    reporter_email: string | null;
    created_at: string;
  }>(sql`
    select
      r.id::text,
      r.target_type::text,
      r.target_id::text,
      r.store_id::text,
      s.name as store_name,
      p.title as product_title,
      r.reason::text,
      r.detail,
      r.status::text,
      u.email as reporter_email,
      r.created_at
    from reports r
    join stores s on s.id = r.store_id
    left join products p on p.id = r.product_id
    left join "user" u on u.id = r.reporter_id
    where r.status in ('open', 'reviewing')
    order by r.created_at asc
    limit ${limit}
  `);

  return rows.map((row) => ({
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    storeId: row.store_id,
    storeName: row.store_name,
    productTitle: row.product_title,
    reason: row.reason,
    detail: row.detail,
    status: row.status,
    reporterEmail: row.reporter_email,
    createdAt: new Date(row.created_at),
  }));
}
