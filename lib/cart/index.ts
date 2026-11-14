import { and, eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { cache } from "react";
import { getSession } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import {
  cartItems,
  carts,
  productImages,
  products,
  productVariants,
  stores,
} from "@/lib/db/schema";
import { readyImage } from "@/lib/media/filters";

export const CART_COOKIE = "cart_token";
const CART_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export type CartLine = {
  itemId: string;
  variantId: string;
  productId: string;
  productSlug: string;
  title: string;
  variantLabel: string | null;
  storeId: string;
  storeName: string;
  imageUrl: string | null;
  /** Resolved live. The cart never stores a price. */
  unitPriceCents: number;
  quantity: number;
  stock: number;
  lineTotalCents: number;
};

export type CartSummary = {
  cartId: string | null;
  lines: CartLine[];
  itemCount: number;
  subtotalCents: number;
  /** Lines whose requested quantity now exceeds stock. */
  problems: { itemId: string; reason: "out-of-stock" | "insufficient-stock" }[];
};

export const EMPTY_CART: CartSummary = {
  cartId: null,
  lines: [],
  itemCount: 0,
  subtotalCents: 0,
  problems: [],
};

/**
 * Finds the current cart without creating one.
 *
 * Signed-in users are keyed by user id; guests by an opaque cookie token. Read
 * paths must never create a row — a crawler hitting every product page would
 * otherwise fill the table with empty carts.
 */
export const getCart = cache(async (): Promise<CartSummary> => {
  const session = await getSession();
  const jar = await cookies();
  const token = jar.get(CART_COOKIE)?.value;

  const cart = session
    ? await db.query.carts.findFirst({
        where: eq(carts.userId, session.user.id),
      })
    : token
      ? await db.query.carts.findFirst({ where: eq(carts.sessionToken, token) })
      : null;

  if (!cart) return EMPTY_CART;
  return summarise(cart.id);
});

async function summarise(cartId: string): Promise<CartSummary> {
  const rows = await db
    .select({
      itemId: cartItems.id,
      variantId: productVariants.id,
      productId: products.id,
      productSlug: products.slug,
      title: products.title,
      optionValues: productVariants.optionValues,
      storeId: stores.id,
      storeName: stores.name,
      // Live price, resolved at render. A price change is reflected
      // immediately rather than a stale cart promising an old number.
      unitPriceCents: productVariants.priceCents,
      quantity: cartItems.quantity,
      stock: productVariants.stock,
      productStatus: products.status,
      storeStatus: stores.status,
    })
    .from(cartItems)
    .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(stores, eq(stores.id, products.storeId))
    .where(eq(cartItems.cartId, cartId))
    .orderBy(cartItems.addedAt);

  const imageRows = rows.length
    ? await db
        .selectDistinctOn([productImages.productId], {
          productId: productImages.productId,
          url: productImages.url,
        })
        .from(productImages)
        // Without readyImage() a video row, or a Drive upload still syncing,
        // wins the position-0 slot and the cart renders a broken thumbnail.
        .where(readyImage())
        .orderBy(productImages.productId, productImages.position)
    : [];
  const imageByProduct = new Map(imageRows.map((r) => [r.productId, r.url]));

  const problems: CartSummary["problems"] = [];
  const lines: CartLine[] = [];

  for (const row of rows) {
    // A product that was archived, or a store that was suspended, drops out of
    // the cart rather than blocking checkout with a confusing error later.
    if (row.productStatus !== "active" || row.storeStatus !== "active")
      continue;

    if (row.stock === 0)
      problems.push({ itemId: row.itemId, reason: "out-of-stock" });
    else if (row.quantity > row.stock)
      problems.push({ itemId: row.itemId, reason: "insufficient-stock" });

    const label =
      Object.keys(row.optionValues ?? {}).length > 0
        ? Object.values(row.optionValues).join(" / ")
        : null;

    lines.push({
      itemId: row.itemId,
      variantId: row.variantId,
      productId: row.productId,
      productSlug: row.productSlug,
      title: row.title,
      variantLabel: label,
      storeId: row.storeId,
      storeName: row.storeName,
      imageUrl: imageByProduct.get(row.productId) ?? null,
      unitPriceCents: row.unitPriceCents,
      quantity: row.quantity,
      stock: row.stock,
      lineTotalCents: row.unitPriceCents * row.quantity,
    });
  }

  return {
    cartId,
    lines,
    itemCount: lines.reduce((n, l) => n + l.quantity, 0),
    subtotalCents: lines.reduce((n, l) => n + l.lineTotalCents, 0),
    problems,
  };
}

/**
 * Finds or creates the cart. Only ever called from a mutation.
 *
 * Setting a cookie is only legal in a server action or route handler, which is
 * the other reason this is kept off the read path.
 */
export async function getOrCreateCartId(): Promise<string> {
  const session = await getSession();
  const jar = await cookies();

  if (session) {
    const existing = await db.query.carts.findFirst({
      where: eq(carts.userId, session.user.id),
    });
    if (existing) return existing.id;

    // A guest who signs in keeps the cart they were building.
    const token = jar.get(CART_COOKIE)?.value;
    if (token) {
      const guestCart = await db.query.carts.findFirst({
        where: eq(carts.sessionToken, token),
      });
      if (guestCart) {
        const [claimed] = await db
          .update(carts)
          .set({ userId: session.user.id, sessionToken: null })
          .where(eq(carts.id, guestCart.id))
          .returning({ id: carts.id });
        jar.delete(CART_COOKIE);
        return claimed.id;
      }
    }

    const [created] = await db
      .insert(carts)
      .values({ userId: session.user.id })
      .returning({ id: carts.id });
    return created.id;
  }

  const token = jar.get(CART_COOKIE)?.value;
  if (token) {
    const existing = await db.query.carts.findFirst({
      where: eq(carts.sessionToken, token),
    });
    if (existing) return existing.id;
  }

  const fresh = crypto.randomUUID();
  const [created] = await db
    .insert(carts)
    .values({ sessionToken: fresh })
    .returning({ id: carts.id });

  jar.set(CART_COOKIE, fresh, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: CART_COOKIE_MAX_AGE,
    path: "/",
  });

  return created.id;
}

export async function addLine(variantId: string, quantity: number) {
  const cartId = await getOrCreateCartId();

  // Adding the same variant twice increments rather than creating a second
  // row, which is what the unique index on (cart_id, variant_id) expects.
  await db
    .insert(cartItems)
    .values({ cartId, variantId, quantity })
    .onConflictDoUpdate({
      target: [cartItems.cartId, cartItems.variantId],
      set: { quantity: sql`${cartItems.quantity} + ${quantity}` },
    });

  return cartId;
}

export async function setLineQuantity(itemId: string, quantity: number) {
  const cartId = await getOrCreateCartId();
  if (quantity <= 0) {
    await db
      .delete(cartItems)
      .where(and(eq(cartItems.id, itemId), eq(cartItems.cartId, cartId)));
    return;
  }
  await db
    .update(cartItems)
    .set({ quantity })
    .where(and(eq(cartItems.id, itemId), eq(cartItems.cartId, cartId)));
}

export async function removeLine(itemId: string) {
  const cartId = await getOrCreateCartId();
  // Scoped to the caller's own cart: an item id from another cart must not be
  // removable just because it is a valid uuid.
  await db
    .delete(cartItems)
    .where(and(eq(cartItems.id, itemId), eq(cartItems.cartId, cartId)));
}
