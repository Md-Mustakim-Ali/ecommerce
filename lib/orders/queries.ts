import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  orderItems,
  orderNotes,
  orders,
  stores,
  subOrders,
} from "@/lib/db/schema";

/**
 * Order reads.
 *
 * Everything displayed comes from the snapshot columns on order_items, never
 * from a join to the live product. A renamed, repriced or deleted product must
 * still render the order exactly as the buyer saw it.
 */

export async function getOrderForBuyer(input: {
  orderId: string;
  userId: string | null;
  /** Lets a guest open their own confirmation from the emailed link. */
  email?: string;
}) {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, input.orderId))
    .limit(1);

  if (!order) return null;

  // A uuid is not authorisation. The order has to belong to this person, by
  // account or by the email it was placed with.
  const ownedByUser = input.userId !== null && order.buyerId === input.userId;
  const ownedByEmail =
    input.email !== undefined &&
    order.email.toLowerCase() === input.email.toLowerCase();
  if (!ownedByUser && !ownedByEmail) return null;

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

  const items = await db
    .select()
    .from(orderItems)
    .innerJoin(subOrders, eq(subOrders.id, orderItems.subOrderId))
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
        .filter((row) => row.order_items.subOrderId === sub.id)
        .map((row) => row.order_items),
      messages: messages.filter((row) => row.subOrderId === sub.id),
    })),
  };
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
      shippingAddress: orders.shippingAddress,
      placedAt: orders.placedAt,
    })
    .from(subOrders)
    .innerJoin(orders, eq(orders.id, subOrders.orderId))
    .where(
      status
        ? and(eq(subOrders.storeId, storeId), eq(subOrders.status, status))
        : eq(subOrders.storeId, storeId),
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
