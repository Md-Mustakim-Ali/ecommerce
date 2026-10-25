import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  orderItems,
  orders,
  products,
  productVariants,
  reviews,
  subOrders,
  user,
} from "@/lib/db/schema";

/**
 * Review reads.
 *
 * Reviews hang off `order_item_id`, so "can this person review this" is a
 * question about a purchase, not about a person and a product. Everything here
 * follows from that.
 */

export type ReviewRow = {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  createdAt: Date;
  authorName: string;
  /** The variant they actually bought, snapshotted on the order item. */
  variantLabel: string | null;
  /** Whether the signed-in reader wrote it, so they can take it down. */
  mine: boolean;
};

export async function listReviewsForProduct(
  productId: string,
  limit = 20,
  /** The signed-in reader, so their own review can be marked. Null for guests. */
  viewerId: string | null = null,
): Promise<ReviewRow[]> {
  const rows = await db
    .select({
      id: reviews.id,
      rating: reviews.rating,
      title: reviews.title,
      body: reviews.body,
      createdAt: reviews.createdAt,
      authorName: user.name,
      variantLabel: orderItems.variantLabel,
      buyerId: reviews.buyerId,
    })
    .from(reviews)
    .innerJoin(user, eq(user.id, reviews.buyerId))
    .innerJoin(orderItems, eq(orderItems.id, reviews.orderItemId))
    // Flagged and removed reviews are invisible and do not count.
    .where(
      and(eq(reviews.productId, productId), eq(reviews.status, "published")),
    )
    .orderBy(desc(reviews.createdAt))
    .limit(limit);

  // Compared here rather than selected as a SQL boolean, so the buyer id never
  // reaches the client. Knowing which account wrote a review is not something
  // the page needs to hand out.
  return rows.map(({ buyerId, ...row }) => ({
    ...row,
    mine: viewerId !== null && buyerId === viewerId,
  }));
}

/** The 1–5 histogram, so the summary shows shape rather than just a mean. */
export async function ratingBreakdown(productId: string) {
  const rows = await db
    .select({
      rating: reviews.rating,
      count: sql<number>`count(*)::int`,
    })
    .from(reviews)
    .where(
      and(eq(reviews.productId, productId), eq(reviews.status, "published")),
    )
    .groupBy(reviews.rating);

  const byRating = new Map(rows.map((row) => [row.rating, row.count]));
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const weighted = rows.reduce((sum, row) => sum + row.rating * row.count, 0);

  return {
    total,
    average: total === 0 ? null : weighted / total,
    // Descending, because that is the order everyone reads a histogram in.
    buckets: [5, 4, 3, 2, 1].map((rating) => ({
      rating,
      count: byRating.get(rating) ?? 0,
    })),
  };
}

export type ReviewablePurchase = {
  orderItemId: string;
  productId: string;
  productSlug: string;
  productTitle: string;
  variantLabel: string | null;
  imageUrl: string | null;
  orderNumber: string;
  deliveredAt: Date | null;
  existing: {
    id: string;
    rating: number;
    title: string | null;
    body: string | null;
  } | null;
};

/**
 * What this buyer may review, and what they already have.
 *
 * Restricted to delivered sub-orders. Reviewing something that has not arrived
 * yet is a review of the checkout, not of the product, and the whole point of
 * anchoring to a purchase is that the rating means something.
 */
export async function listReviewablePurchases(
  userId: string,
  productId?: string,
): Promise<ReviewablePurchase[]> {
  const rows = await db
    .select({
      orderItemId: orderItems.id,
      productId: products.id,
      productSlug: products.slug,
      productTitle: orderItems.productTitle,
      variantLabel: orderItems.variantLabel,
      imageUrl: orderItems.imageUrl,
      orderNumber: orders.orderNumber,
      deliveredAt: subOrders.deliveredAt,
      reviewId: reviews.id,
      reviewRating: reviews.rating,
      reviewTitle: reviews.title,
      reviewBody: reviews.body,
    })
    .from(orderItems)
    .innerJoin(subOrders, eq(subOrders.id, orderItems.subOrderId))
    .innerJoin(orders, eq(orders.id, subOrders.orderId))
    // Through the variant to its product. Order items snapshot their title, so
    // the live product has to be reached by reference — and an inner join
    // drops items whose variant was deleted, which is correct: there is nothing
    // left to attach a review to.
    .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(reviews, eq(reviews.orderItemId, orderItems.id))
    .where(
      and(
        eq(orders.buyerId, userId),
        eq(subOrders.status, "delivered"),
        productId ? eq(products.id, productId) : sql`true`,
      ),
    )
    .orderBy(desc(subOrders.deliveredAt));

  return rows.map((row) => ({
    orderItemId: row.orderItemId,
    productId: row.productId,
    productSlug: row.productSlug,
    productTitle: row.productTitle,
    variantLabel: row.variantLabel,
    imageUrl: row.imageUrl,
    orderNumber: row.orderNumber,
    deliveredAt: row.deliveredAt,
    existing: row.reviewId
      ? {
          id: row.reviewId,
          rating: row.reviewRating ?? 0,
          title: row.reviewTitle,
          body: row.reviewBody,
        }
      : null,
  }));
}
