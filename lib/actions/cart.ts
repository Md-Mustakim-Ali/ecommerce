"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  addLine,
  type CartSummary,
  getCart,
  removeLine,
  setLineQuantity,
} from "@/lib/cart";
import { db } from "@/lib/db";
import { products, productVariants, stores } from "@/lib/db/schema";

const addSchema = z.object({
  variantId: z.uuid(),
  quantity: z.coerce.number().int().min(1).max(99),
});

export type CartActionResult =
  | { ok: true; cart: CartSummary }
  | { ok: false; message: string };

export async function addToCartAction(input: {
  variantId: string;
  quantity?: number;
}): Promise<CartActionResult> {
  const parsed = addSchema.safeParse({
    variantId: input.variantId,
    quantity: input.quantity ?? 1,
  });
  if (!parsed.success) return { ok: false, message: "Invalid request." };

  // The variant id comes from the client. Confirm it is real, live, and
  // belongs to an active store before it can enter a cart.
  const [variant] = await db
    .select({
      id: productVariants.id,
      stock: productVariants.stock,
      productStatus: products.status,
      storeStatus: stores.status,
      title: products.title,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(stores, eq(stores.id, products.storeId))
    .where(eq(productVariants.id, parsed.data.variantId))
    .limit(1);

  if (
    !variant ||
    variant.productStatus !== "active" ||
    variant.storeStatus !== "active"
  ) {
    return { ok: false, message: "That item is no longer available." };
  }
  if (variant.stock < parsed.data.quantity) {
    return {
      ok: false,
      message:
        variant.stock === 0
          ? "That item is sold out."
          : `Only ${variant.stock} left.`,
    };
  }

  await addLine(parsed.data.variantId, parsed.data.quantity);

  // Deliberately not revalidating the whole layout: the badge updates
  // optimistically on the client, and a full revalidate would undo that.
  const cart = await getCart();
  return { ok: true, cart };
}

export async function setCartQuantityAction(input: {
  itemId: string;
  quantity: number;
}): Promise<CartActionResult> {
  const itemId = z.uuid().parse(input.itemId);
  const quantity = z.coerce.number().int().min(0).max(99).parse(input.quantity);

  await setLineQuantity(itemId, quantity);
  revalidatePath("/cart");
  return { ok: true, cart: await getCart() };
}

export async function removeFromCartAction(input: {
  itemId: string;
}): Promise<CartActionResult> {
  const itemId = z.uuid().parse(input.itemId);
  await removeLine(itemId);
  revalidatePath("/cart");
  return { ok: true, cart: await getCart() };
}

export async function refreshCartAction(): Promise<CartSummary> {
  return getCart();
}
