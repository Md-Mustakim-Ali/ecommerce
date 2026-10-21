"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import {
  orderItems,
  orders,
  products,
  productVariants,
  reviews,
  subOrders,
} from "@/lib/db/schema";

/**
 * Writing a review.
 *
 * Authorisation is the whole design here: a review is keyed to an order item,
 * so the only person who can write one is the person who bought that specific
 * item, and the unique index on `order_item_id` means one review per purchase
 * rather than one per person per product.
 *
 * The product id is derived from the purchase rather than accepted from the
 * client. Taking it from the request would let anyone with a single delivered
 * order post a five-star review against any product on the platform.
 */

export type ReviewResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

const reviewSchema = z.object({
  orderItemId: z.uuid(),
  rating: z.coerce.number().int().min(1, "Pick a rating").max(5),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().max(4000).optional(),
});

export async function submitReviewAction(
  input: z.input<typeof reviewSchema>,
): Promise<ReviewResult> {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const { orderItemId, rating, title, body } = parsed.data;

  const session = await getSession();
  if (!session) return { ok: false, message: "Sign in to write a review." };

  // One query answers every authorisation question: is this the buyer's own
  // purchase, has it been delivered, and which product does it belong to.
  const [purchase] = await db
    .select({
      orderItemId: orderItems.id,
      productId: products.id,
      productSlug: products.slug,
      buyerId: orders.buyerId,
      subStatus: subOrders.status,
    })
    .from(orderItems)
    .innerJoin(subOrders, eq(subOrders.id, orderItems.subOrderId))
    .innerJoin(orders, eq(orders.id, subOrders.orderId))
    .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(orderItems.id, orderItemId))
    .limit(1);

  // Same response for "does not exist" and "not yours", so an id cannot be
  // probed to learn whether an order item exists.
  if (!purchase || purchase.buyerId !== session.user.id) {
    return { ok: false, message: "You can only review something you bought." };
  }
  if (purchase.subStatus !== "delivered") {
    return {
      ok: false,
      message: "You can review this once it has been delivered.",
    };
  }

  const existing = await db.query.reviews.findFirst({
    where: eq(reviews.orderItemId, orderItemId),
    columns: { id: true, buyerId: true },
  });

  if (existing) {
    // The unique index already guarantees this row is the buyer's own, but
    // checking makes the intent explicit rather than implied by a constraint.
    if (existing.buyerId !== session.user.id) {
      return { ok: false, message: "You can only edit your own review." };
    }
    await db
      .update(reviews)
      .set({ rating, title: title || null, body: body || null })
      .where(eq(reviews.id, existing.id));
  } else {
    await db.insert(reviews).values({
      productId: purchase.productId,
      buyerId: session.user.id,
      orderItemId,
      rating,
      title: title || null,
      body: body || null,
    });
  }

  revalidatePath(`/p/${purchase.productSlug}`);
  revalidatePath("/account/orders");

  return {
    ok: true,
    message: existing ? "Review updated." : "Thanks for the review.",
  };
}

export async function deleteReviewAction(input: {
  reviewId: string;
}): Promise<ReviewResult> {
  const reviewId = z.uuid().parse(input.reviewId);

  const session = await getSession();
  if (!session) return { ok: false, message: "Not signed in." };

  const [existing] = await db
    .select({
      id: reviews.id,
      buyerId: reviews.buyerId,
      slug: products.slug,
    })
    .from(reviews)
    .innerJoin(products, eq(products.id, reviews.productId))
    .where(and(eq(reviews.id, reviewId), eq(reviews.buyerId, session.user.id)))
    .limit(1);

  if (!existing) return { ok: false, message: "Review not found." };

  await db.delete(reviews).where(eq(reviews.id, reviewId));

  revalidatePath(`/p/${existing.slug}`);
  revalidatePath("/account/orders");
  return { ok: true, message: "Review removed." };
}
