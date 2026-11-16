import { and, asc, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  jommaAppliedPayments,
  orderItems,
  orderNotes,
  orders,
  products,
  productVariants,
  stores,
  subOrders,
} from "@/lib/db/schema";
import { orderBelongsTo } from "./ownership";

/**
 * Order reads.
 *
 * Everything displayed comes from the snapshot columns on order_items, never
 * from a join to the live product. A renamed, repriced or deleted product must
 * still render the order exactly as the buyer saw it.
 *
 * The one thing read from the live product is its slug, and only to build a
 * link. That is navigation rather than display: no figure, name or price on
 * the order changes because of it, and the slug is dropped entirely when the
 * product or its store is no longer active, so a link is never rendered to a
 * page that would 404.
 */

export async function getOrderForBuyer(input: {
  orderId: string;
  userId: string | null;
  /** Lets a guest open their own confirmation from the emailed link. */
  email?: string;
  /** The same, for a buyer who checked out with a number and no address. */
  phone?: string;
  /**
   * The `?t=` a receipt link or the post-checkout redirect carries.
   *
   * This is how a guest gets in: they have no session, and the page cannot
   * ask them for the address they checked out with.
   */
  accessToken?: string;
}) {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, input.orderId))
    .limit(1);

  if (!order) return null;

  // A uuid is not authorisation. The order has to belong to this person.
  if (!orderBelongsTo(order, input)) return null;

  const subs = await db
    .select({
      id: subOrders.id,
      status: subOrders.status,
      storeName: stores.name,
      storeSlug: stores.slug,
      subtotalCents: subOrders.subtotalCents,
      shippingCents: subOrders.shippingCents,
      trackingCarrier: subOrders.trackingCarrier,
      trackingNumber: subOrders.trackingNumber,
      shippedAt: subOrders.shippedAt,
      deliveredAt: subOrders.deliveredAt,
    })
    .from(subOrders)
    .innerJoin(stores, eq(stores.id, subOrders.storeId))
    .where(eq(subOrders.orderId, order.id));

  /*
    Items, plus a slug to link each one back to its product.

    The displayed columns stay snapshots — title, price and SKU are still read
    from order_items and never from the live product, so a renamed or repriced
    product cannot change what this order says it was. The slug is navigation,
    not display, which is a different thing: the buyer looking at "Waxed walnut
    portable speaker" reasonably expects clicking it to go there.

    Left joins the whole way down, because every link in the chain is allowed
    to be missing. `variantId` is `on delete set null`, so a deleted variant
    leaves the item intact with nothing to point at.

    Both statuses are checked because getProductBySlug requires both — it
    filters `products.status = 'active'` and `stores.status = 'active'` — so
    linking on anything less would render a link straight to a 404. An
    archived product is exactly the case: still perfectly real on this order,
    no longer a page.
  */
  const items = await db
    .select({
      item: orderItems,
      productSlug: products.slug,
      productStatus: products.status,
      productStoreStatus: stores.status,
    })
    .from(orderItems)
    .innerJoin(subOrders, eq(subOrders.id, orderItems.subOrderId))
    .leftJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .leftJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(stores, eq(stores.id, products.storeId))
    .where(eq(subOrders.orderId, order.id));

  // Only the buyer-visible half. Internal notes are filtered in SQL rather
  // than in the component, so a future change to the markup cannot leak them.
  const messages = subs.length
    ? await db
        .select({
          id: orderNotes.id,
          subOrderId: orderNotes.subOrderId,
          authorRole: orderNotes.authorRole,
          authorName: orderNotes.authorName,
          body: orderNotes.body,
          createdAt: orderNotes.createdAt,
        })
        .from(orderNotes)
        .where(
          and(
            inArray(
              orderNotes.subOrderId,
              subs.map((sub) => sub.id),
            ),
            eq(orderNotes.visibility, "buyer"),
          ),
        )
        .orderBy(asc(orderNotes.createdAt))
    : [];

  return {
    ...order,
    subOrders: subs.map((sub) => ({
      ...sub,
      items: items
        .filter((row) => row.item.subOrderId === sub.id)
        .map((row) => ({
          ...row.item,
          // Null unless the page it would point at actually exists.
          productSlug:
            row.productStatus === "active" &&
            row.productStoreStatus === "active"
              ? row.productSlug
              : null,
        })),
      messages: messages.filter((row) => row.subOrderId === sub.id),
    })),
  };
}

/**
 * The individual transfers that paid an order, oldest first.
 *
 * More than one row is a split payment — a buyer who sent part of the total and
 * topped it up later. Each has its own TrxID and may have come from a different
 * handset, which is precisely why this returns a list rather than the schema
 * keeping one `trx_id` on the order and quietly losing the rest.
 *
 * Read from our own table, not from Jomma. The rows are written by the webhook
 * and by the status poll; a page rendering an old order must not depend on a
 * payment provider being reachable.
 */
export async function getAppliedPaymentsForOrder(orderId: string) {
  return db
    .select({
      id: jommaAppliedPayments.id,
      trxId: jommaAppliedPayments.trxId,
      senderMsisdn: jommaAppliedPayments.senderMsisdn,
      amountCents: jommaAppliedPayments.amountCents,
      occurredAt: jommaAppliedPayments.occurredAt,
      appliedAt: jommaAppliedPayments.appliedAt,
      matchConfidence: jommaAppliedPayments.matchConfidence,
      matchedBy: jommaAppliedPayments.matchedBy,
    })
    .from(jommaAppliedPayments)
    .where(eq(jommaAppliedPayments.orderId, orderId))
    .orderBy(asc(jommaAppliedPayments.appliedAt));
}

export async function listOrdersForBuyer(userId: string) {
  const rows = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      totalCents: orders.totalCents,
      currency: orders.currency,
      placedAt: orders.placedAt,
    })
    .from(orders)
    .where(eq(orders.buyerId, userId))
    .orderBy(desc(orders.placedAt))
    .limit(50);

  return rows;
}

/** Sub-orders for a store, i.e. the seller's order queue. */
export async function listOrdersForStore(
  storeId: string,
  status?:
    | "pending"
    | "accepted"
    | "shipped"
    | "delivered"
    | "cancelled"
    | "refunded",
) {
  const rows = await db
    .select({
      id: subOrders.id,
      status: subOrders.status,
      subtotalCents: subOrders.subtotalCents,
      shippingCents: subOrders.shippingCents,
      payoutCents: subOrders.payoutCents,
      trackingCarrier: subOrders.trackingCarrier,
      trackingNumber: subOrders.trackingNumber,
      orderNumber: orders.orderNumber,
      orderStatus: orders.status,
      buyerEmail: orders.email,
      buyerPhone: orders.contactPhone,
      shippingAddress: orders.shippingAddress,
      placedAt: orders.placedAt,
    })
    .from(subOrders)
    .innerJoin(orders, eq(orders.id, subOrders.orderId))
    .where(
      and(
        eq(subOrders.storeId, storeId),
        status ? eq(subOrders.status, status) : undefined,
        /**
         * An unconfirmed order is not a sale, and a seller must never see one.
         *
         * The filter is on the PARENT order rather than the sub-order, because
         * sub_orders.status tracks fulfilment and stays `pending` either way.
         * Without this the queue would show orders from guests who typed an
         * address they do not hold — which is the exact thing confirmation
         * exists to keep out of a seller's day.
         */
        ne(orders.status, "unconfirmed"),
      ),
    )
    .orderBy(desc(orders.placedAt))
    .limit(100);

  const items = await db
    .select()
    .from(orderItems)
    .innerJoin(subOrders, eq(subOrders.id, orderItems.subOrderId))
    .where(eq(subOrders.storeId, storeId));

  // A separate grouped query, not a correlated subquery. Drizzle renders an
  // outer column reference inside a raw sql template unqualified, and Postgres
  // then resolves it against the subquery's own tables — which has silently
  // produced the wrong number here four times already.
  const noteCounts = rows.length
    ? await db
        .select({
          subOrderId: orderNotes.subOrderId,
          total: count(),
          unread: count(
            sql`case when ${orderNotes.authorRole} = 'buyer' and ${orderNotes.readAt} is null then 1 end`,
          ),
        })
        .from(orderNotes)
        .where(
          inArray(
            orderNotes.subOrderId,
            rows.map((row) => row.id),
          ),
        )
        .groupBy(orderNotes.subOrderId)
    : [];

  return rows.map((row) => {
    const notes = noteCounts.find((entry) => entry.subOrderId === row.id);
    return {
      ...row,
      noteCount: notes?.total ?? 0,
      unreadFromBuyer: notes?.unread ?? 0,
      items: items
        .filter((item) => item.order_items.subOrderId === row.id)
        .map((item) => item.order_items),
    };
  });
}

/** One sub-order, scoped to its store so an id from elsewhere resolves to null. */
export async function getSubOrderForStore(subOrderId: string, storeId: string) {
  const [row] = await db
    .select({
      id: subOrders.id,
      orderId: subOrders.orderId,
      status: subOrders.status,
      storeId: subOrders.storeId,
      orderNumber: orders.orderNumber,
      orderStatus: orders.status,
    })
    .from(subOrders)
    .innerJoin(orders, eq(orders.id, subOrders.orderId))
    .where(and(eq(subOrders.id, subOrderId), eq(subOrders.storeId, storeId)))
    .limit(1);

  return row ?? null;
}
