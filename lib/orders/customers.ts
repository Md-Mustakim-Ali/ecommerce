import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customerKeyFor, type ParsedCustomerKey } from "./customer-key";

/**
 * A store's customers, derived rather than stored.
 *
 * ── One definition of "the same person", used everywhere ─────────────────
 *
 * There is no customers table. Who a buyer is comes from three columns on the
 * order, any of which may be absent — see ./customer-key.ts for the rule and
 * its limits. What matters here is that the rule exists once.
 *
 * It did not. `repeatPurchaseForStore` in lib/analytics grouped on `buyer_id`
 * and filtered out nulls, so every guest order was invisible to it — on a shop
 * where guest checkout is the normal case, the repeat-purchase rate was
 * computed over a signed-in minority and reported as the store's. That query
 * now groups by the expression below, so the two views of a customer cannot
 * disagree.
 *
 * ── The boundary that matters most ───────────────────────────────────────
 *
 * Every figure here is THIS STORE'S PART of an order and nothing else. A buyer
 * paying for a cart spanning three sellers produces one order and three
 * sub-orders, and a seller must never see the other two — not the items, not
 * the totals, not the fact they exist. Amounts therefore come from
 * `sub_orders`, never from `orders.total_cents`, and every query is filtered on
 * `store_id` before anything is aggregated.
 */

/**
 * The grouping expression, matching customerKeyFor's precedence exactly.
 *
 * Deliberately NOT the prefixed key itself. Postgres's base64 is not base64url,
 * so building the key in SQL would produce a string that JS decodes differently
 * — two spellings of one identity, which is the bug this module exists to
 * avoid. SQL groups; JS names.
 */
const GROUP_KEY = sql`coalesce(o.buyer_id::text, nullif(lower(btrim(o.email)), ''), o.contact_phone)`;

/** Cancelled and refunded parts are not money this customer spent here. */
const COUNTS_AS_SPEND = sql`so.status not in ('cancelled', 'refunded')`;

/** An unproved contact is not a customer — the same rule the queue uses. */
const REAL_ORDER = sql`o.status <> 'unconfirmed'`;

export type StoreCustomer = {
  key: string;
  buyerId: string | null;
  email: string | null;
  contactPhone: string | null;
  recipientName: string | null;
  /** Orders containing this store's items. Never the buyer's whole history. */
  orderCount: number;
  /** This store's share only, excluding cancelled and refunded parts. */
  spentCents: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
};

export async function listCustomersForStore(
  storeId: string,
  limit = 200,
): Promise<StoreCustomer[]> {
  const rows = await db.execute<{
    buyer_id: string | null;
    email: string | null;
    contact_phone: string | null;
    recipient_name: string | null;
    order_count: string;
    spent_cents: string;
    first_order_at: string | null;
    last_order_at: string | null;
  }>(sql`
    select
      max(o.buyer_id::text) as buyer_id,
      max(o.email) as email,
      max(o.contact_phone) as contact_phone,
      -- The name on the most recent order, which is the one worth showing.
      (array_agg(o.shipping_address ->> 'recipientName'
                 order by o.placed_at desc nulls last))[1] as recipient_name,
      count(distinct o.id)::text as order_count,
      coalesce(sum(so.subtotal_cents + so.shipping_cents)
               filter (where ${COUNTS_AS_SPEND}), 0)::text as spent_cents,
      min(o.placed_at) as first_order_at,
      max(o.placed_at) as last_order_at
    from sub_orders so
    join orders o on o.id = so.order_id
    where so.store_id = ${storeId}
      and ${REAL_ORDER}
    group by ${GROUP_KEY}
    having ${GROUP_KEY} is not null
    order by max(o.placed_at) desc nulls last
    limit ${limit}
  `);

  return rows
    .map((row) => {
      const identity = {
        buyerId: row.buyer_id,
        email: row.email,
        contactPhone: row.contact_phone,
      };
      const key = customerKeyFor(identity);
      if (!key) return null;
      return {
        key,
        ...identity,
        recipientName: row.recipient_name,
        orderCount: Number(row.order_count),
        spentCents: Number(row.spent_cents),
        firstOrderAt: row.first_order_at ? new Date(row.first_order_at) : null,
        lastOrderAt: row.last_order_at ? new Date(row.last_order_at) : null,
      };
    })
    .filter((row): row is StoreCustomer => row !== null);
}

/**
 * Which orders belong to one customer — restricted to this store's parts.
 *
 * Returns sub-order ids, so the caller can reuse the order queue's own row and
 * inherit its permission handling rather than growing a second, subtly
 * different rendering of an order.
 *
 * The store filter is applied in SQL alongside the identity filter, not after
 * it. Fetching a customer's orders and then filtering by store in JS is the
 * shape that leaks: one forgotten filter and a seller is reading another
 * seller's sales.
 */
export async function subOrderIdsForCustomer(
  storeId: string,
  parsed: ParsedCustomerKey,
): Promise<string[]> {
  if (!parsed) return [];

  const identity =
    parsed.kind === "account"
      ? sql`o.buyer_id::text = ${parsed.buyerId}`
      : parsed.kind === "email"
        ? sql`o.buyer_id is null and lower(btrim(o.email)) = ${parsed.email}`
        : sql`o.buyer_id is null and nullif(lower(btrim(o.email)), '') is null and o.contact_phone = ${parsed.phone}`;

  const rows = await db.execute<{ id: string }>(sql`
    select so.id
    from sub_orders so
    join orders o on o.id = so.order_id
    where so.store_id = ${storeId}
      and ${REAL_ORDER}
      and ${identity}
    order by o.placed_at desc nulls last
    limit 100
  `);

  return rows.map((row) => row.id);
}

/**
 * The grouping expression, for callers outside this module.
 *
 * Exported so lib/analytics counts the same people this page lists. Two
 * definitions of a customer is how a dashboard ends up reporting a repeat rate
 * that contradicts the list of repeat customers sitting next to it.
 */
export const CUSTOMER_GROUP_KEY = GROUP_KEY;
export const CUSTOMER_REAL_ORDER = REAL_ORDER;
