import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  cartItems,
  discountCodes,
  discountRedemptions,
  orderItems,
  orders,
  productImages,
  products,
  productVariants,
  stores,
  subOrders,
} from "@/lib/db/schema";
import type { AddressSnapshot } from "@/lib/db/schema/orders";
import { readyImage } from "@/lib/media/filters";
import {
  assertOrderBalances,
  buildOrderTotals,
  type CartLineInput,
} from "@/lib/money/order-math";

export type PlaceOrderInput = {
  cartId: string;
  buyerId: string | null;
  email: string;
  shippingAddress: AddressSnapshot;
  billingAddress?: AddressSnapshot;
  currency: string;
  shippingCents: number;
  taxCents?: number;
  discountCents?: number;
  /**
   * The code being redeemed, if any.
   *
   * Recorded inside the order transaction so the counter and the order rise or
   * fall together. Incrementing it beforehand would leak a redemption every
   * time a checkout failed on stock.
   */
  discount?: { id: string; code: string; amountCents: number };
  /**
   * The rate at the moment of purchase.
   *
   * Passed in rather than read here, so the rate that priced the order is the
   * one recorded on it. sub_orders.commission_cents is then the permanent
   * record — changing the platform rate later must never restate what a past
   * order earned.
   */
  commissionBps?: number;
};

export type PlaceOrderResult =
  | { ok: true; orderId: string; orderNumber: string; totalCents: number }
  | {
      ok: false;
      reason: "empty-cart" | "stock" | "unavailable";
      message: string;
    };

/**
 * Human-readable order number. ORD-2026-000123.
 *
 * A sequence rather than a random string: support has to read these aloud, and
 * a buyer has to find one in an email.
 */
async function nextOrderNumber(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
): Promise<string> {
  const year = new Date().getUTCFullYear();
  const [row] = await tx.execute<{ n: string }>(
    sql`select nextval('order_number_seq') as n`,
  );
  return `ORD-${year}-${String(row.n).padStart(6, "0")}`;
}

/**
 * Places an order.
 *
 * Everything happens in one transaction: the order, its per-store sub-orders,
 * the snapshotted line items, and the stock decrement. AGENTS.md is explicit —
 * stock decrement, order creation and the payment record succeed or fail
 * together. A half-placed order is worse than a failed one.
 *
 * Stock is decremented with a conditional UPDATE rather than a read-then-write.
 * Two buyers racing for the last unit both read stock = 1; only one of them
 * can satisfy `where stock >= quantity`, and the loser gets a clean failure
 * instead of overselling.
 *
 * No money moves here. The ledger is written when payment actually succeeds,
 * which is the webhook's job.
 */
export async function placeOrder(
  input: PlaceOrderInput,
): Promise<PlaceOrderResult> {
  return db.transaction(async (tx) => {
    // Locked for the duration so a concurrent add-to-cart cannot change what
    // is being ordered halfway through pricing it.
    const rows = await tx
      .select({
        variantId: productVariants.id,
        storeId: products.storeId,
        unitPriceCents: productVariants.priceCents,
        quantity: cartItems.quantity,
        stock: productVariants.stock,
        sku: productVariants.sku,
        optionValues: productVariants.optionValues,
        productId: products.id,
        productTitle: products.title,
        productStatus: products.status,
        storeStatus: stores.status,
      })
      .from(cartItems)
      .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .innerJoin(stores, eq(stores.id, products.storeId))
      .where(eq(cartItems.cartId, input.cartId))
      .for("update", { of: productVariants });

    if (rows.length === 0) {
      return {
        ok: false as const,
        reason: "empty-cart" as const,
        message: "Your cart is empty.",
      };
    }

    const unavailable = rows.find(
      (r) => r.productStatus !== "active" || r.storeStatus !== "active",
    );
    if (unavailable) {
      return {
        ok: false as const,
        reason: "unavailable" as const,
        message: `"${unavailable.productTitle}" is no longer available. Remove it to continue.`,
      };
    }

    const short = rows.find((r) => r.stock < r.quantity);
    if (short) {
      return {
        ok: false as const,
        reason: "stock" as const,
        message:
          short.stock === 0
            ? `"${short.productTitle}" sold out while you were checking out.`
            : `Only ${short.stock} of "${short.productTitle}" left.`,
      };
    }

    const lines: CartLineInput[] = rows.map((r) => ({
      variantId: r.variantId,
      storeId: r.storeId,
      unitPriceCents: r.unitPriceCents,
      quantity: r.quantity,
    }));

    const totals = buildOrderTotals({
      lines,
      shippingCents: input.shippingCents,
      commissionBps: input.commissionBps,
      taxCents: input.taxCents ?? 0,
      discountCents: input.discountCents ?? 0,
    });

    // Refuses to write a split that does not reconcile. Finding this out later
    // means unpicking real payments.
    assertOrderBalances(totals);

    const orderNumber = await nextOrderNumber(tx);

    const [order] = await tx
      .insert(orders)
      .values({
        buyerId: input.buyerId,
        orderNumber,
        email: input.email,
        status: "pending",
        subtotalCents: totals.subtotalCents,
        shippingCents: totals.shippingCents,
        taxCents: totals.taxCents,
        discountCents: totals.discountCents,
        totalCents: totals.totalCents,
        currency: input.currency,
        // SNAPSHOT. Editing a saved address must never change what a past
        // order says it shipped to.
        shippingAddress: input.shippingAddress,
        billingAddress: input.billingAddress ?? input.shippingAddress,
        placedAt: new Date(),
      })
      .returning({ id: orders.id });

    // One primary image per product, for the order-item snapshot.
    const imageRows = await tx
      .selectDistinctOn([productImages.productId], {
        productId: productImages.productId,
        url: productImages.url,
      })
      .from(productImages)
      // The snapshot is permanent — an order keeps whatever URL it was given
      // forever — so an unfinished upload landing here is uncorrectable later.
      .where(readyImage())
      .orderBy(productImages.productId, productImages.position);
    const imageByProduct = new Map(imageRows.map((r) => [r.productId, r.url]));
    const rowByVariant = new Map(rows.map((r) => [r.variantId, r]));

    for (const sub of totals.subOrders) {
      const [subOrder] = await tx
        .insert(subOrders)
        .values({
          orderId: order.id,
          storeId: sub.storeId,
          status: "pending",
          subtotalCents: sub.subtotalCents,
          shippingCents: sub.shippingCents,
          commissionCents: sub.commissionCents,
          payoutCents: sub.payoutCents,
        })
        .returning({ id: subOrders.id });

      await tx.insert(orderItems).values(
        sub.lines.map((lineInput) => {
          const row = rowByVariant.get(lineInput.variantId);
          const label =
            row && Object.keys(row.optionValues ?? {}).length > 0
              ? Object.values(row.optionValues).join(" / ")
              : null;

          return {
            subOrderId: subOrder.id,
            variantId: lineInput.variantId,
            // Every one of these is a snapshot. If the seller renames or
            // deletes the product, this order still renders as the buyer saw it.
            productTitle: row?.productTitle ?? "Unknown item",
            variantLabel: label,
            sku: row?.sku ?? null,
            imageUrl: row ? (imageByProduct.get(row.productId) ?? null) : null,
            unitPriceCents: lineInput.unitPriceCents,
            quantity: lineInput.quantity,
            lineTotalCents: lineInput.unitPriceCents * lineInput.quantity,
          };
        }),
      );
    }

    // Conditional decrement. Even holding FOR UPDATE, this is the assertion
    // that stock never goes negative — the CHECK constraint would otherwise
    // abort the whole transaction with a much less useful error.
    for (const row of rows) {
      const updated = await tx
        .update(productVariants)
        .set({ stock: sql`${productVariants.stock} - ${row.quantity}` })
        .where(
          and(
            eq(productVariants.id, row.variantId),
            sql`${productVariants.stock} >= ${row.quantity}`,
          ),
        )
        .returning({ id: productVariants.id });

      if (updated.length === 0) {
        // Rolls the whole transaction back, including the order.
        throw new Error(
          `Stock changed while placing the order: ${row.productTitle}`,
        );
      }
    }

    if (input.discount) {
      // Conditional increment. Two checkouts racing for the last use of a
      // limited code both pass the earlier availability check; only one can
      // pass this, and the loser's whole transaction rolls back.
      const claimed = await tx
        .update(discountCodes)
        .set({ redemptionCount: sql`${discountCodes.redemptionCount} + 1` })
        .where(
          and(
            eq(discountCodes.id, input.discount.id),
            sql`${discountCodes.maxRedemptions} is null
                or ${discountCodes.redemptionCount} < ${discountCodes.maxRedemptions}`,
          ),
        )
        .returning({ id: discountCodes.id });

      if (claimed.length === 0) {
        throw new Error(
          `The code ${input.discount.code} was fully claimed while you were checking out.`,
        );
      }

      await tx.insert(discountRedemptions).values({
        discountId: input.discount.id,
        orderId: order.id,
        userId: input.buyerId,
        email: input.email,
        amountCents: input.discount.amountCents,
      });
    }

    // The cart is emptied, not deleted, so the buyer keeps the same cart row.
    await tx.delete(cartItems).where(eq(cartItems.cartId, input.cartId));

    return {
      ok: true as const,
      orderId: order.id,
      orderNumber,
      totalCents: totals.totalCents,
    };
  });
}
