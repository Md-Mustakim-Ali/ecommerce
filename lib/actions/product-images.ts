"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStorePermission } from "@/lib/auth/access";
import { db } from "@/lib/db";
import {
  attributeValues,
  productAttributeValues,
  productImageAttributeValues,
  productImages,
  products,
} from "@/lib/db/schema";
import {
  isAcceptedImageType,
  MAX_IMAGE_BYTES,
  storageProvider,
} from "@/lib/storage";

/**
 * Product images.
 *
 * Uploads arrive as FormData rather than as a JSON payload, because a base64
 * string in a server action argument is a third larger than the file and has to
 * be held in memory whole on both sides.
 *
 * The interesting part is the tagging. An image can be pinned to one or more
 * attribute values, and the storefront switches to the most specific matching
 * photo when a shopper picks an option. That behaviour has existed since the
 * catalog work; until now only the seed could produce the tags it reads.
 */

export type ImageResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

async function ownedProduct(productId: string, storeId: string) {
  const [row] = await db
    .select({ id: products.id, slug: products.slug })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.storeId, storeId)))
    .limit(1);
  return row ?? null;
}

const MAX_IMAGES_PER_PRODUCT = 12;

export async function uploadProductImageAction(
  formData: FormData,
): Promise<ImageResult> {
  const storeId = z.uuid().safeParse(formData.get("storeId"));
  const productId = z.uuid().safeParse(formData.get("productId"));
  if (!storeId.success || !productId.success) {
    return { ok: false, message: "Invalid request." };
  }

  await requireStorePermission(storeId.data, "product.update");
  const owned = await ownedProduct(productId.data, storeId.data);
  if (!owned) return { ok: false, message: "Product not found." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose a file." };
  }

  // Both checks are server-side. The accept attribute on the input is a
  // convenience for the file picker and is trivially bypassed.
  if (!isAcceptedImageType(file.type)) {
    return {
      ok: false,
      message: "Images only — JPEG, PNG, WebP or AVIF.",
    };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      message: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`,
    };
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(productImages)
    .where(eq(productImages.productId, productId.data));

  if (count >= MAX_IMAGES_PER_PRODUCT) {
    return {
      ok: false,
      message: `A product can have ${MAX_IMAGES_PER_PRODUCT} images. Remove one first.`,
    };
  }

  let stored: Awaited<ReturnType<ReturnType<typeof storageProvider>["upload"]>>;
  try {
    stored = await storageProvider().upload({
      scope: `products/${productId.data}`,
      filename: file.name,
      contentType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }

  await db.insert(productImages).values({
    productId: productId.data,
    url: stored.url,
    alt: String(formData.get("alt") ?? "").slice(0, 200) || null,
    position: count,
    blurDataUrl: stored.blurDataUrl,
    width: stored.width,
    height: stored.height,
  });

  revalidatePath(`/dashboard/${storeId.data}/products/${productId.data}`);
  revalidatePath(`/p/${owned.slug}`);
  return { ok: true, message: "Uploaded." };
}

export async function deleteProductImageAction(input: {
  storeId: string;
  productId: string;
  imageId: string;
}): Promise<ImageResult> {
  const storeId = z.uuid().parse(input.storeId);
  const productId = z.uuid().parse(input.productId);
  const imageId = z.uuid().parse(input.imageId);

  await requireStorePermission(storeId, "product.update");
  const owned = await ownedProduct(productId, storeId);
  if (!owned) return { ok: false, message: "Product not found." };

  const [image] = await db
    .select({ id: productImages.id, url: productImages.url })
    .from(productImages)
    .where(
      and(
        eq(productImages.id, imageId),
        eq(productImages.productId, productId),
      ),
    )
    .limit(1);

  if (!image) return { ok: false, message: "Image not found." };

  await db.delete(productImages).where(eq(productImages.id, imageId));

  // The row goes first. An orphaned file wastes disk; a row pointing at a
  // deleted file is a broken image on the storefront, which is worse.
  try {
    await storageProvider().remove(image.url.replace(/^\/uploads\//, ""));
  } catch {
    // Seeded images live on a remote host and have no local file. Failing to
    // delete something that was never ours must not fail the request.
  }

  revalidatePath(`/dashboard/${storeId}/products/${productId}`);
  revalidatePath(`/p/${owned.slug}`);
  return { ok: true, message: "Removed." };
}

const reorderSchema = z.object({
  storeId: z.uuid(),
  productId: z.uuid(),
  imageIds: z.array(z.uuid()).min(1).max(MAX_IMAGES_PER_PRODUCT),
});

export async function reorderProductImagesAction(
  input: z.input<typeof reorderSchema>,
): Promise<ImageResult> {
  const parsed = reorderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid order." };
  const data = parsed.data;

  await requireStorePermission(data.storeId, "product.update");
  const owned = await ownedProduct(data.productId, data.storeId);
  if (!owned) return { ok: false, message: "Product not found." };

  const existing = await db
    .select({ id: productImages.id })
    .from(productImages)
    .where(eq(productImages.productId, data.productId));

  // The submitted list has to be a permutation of what is actually on the
  // product — no additions, no omissions, nothing from another listing.
  const own = new Set(existing.map((row) => row.id));
  if (
    data.imageIds.length !== own.size ||
    data.imageIds.some((id) => !own.has(id))
  ) {
    return {
      ok: false,
      message: "That ordering no longer matches the images.",
    };
  }

  await db.transaction(async (tx) => {
    for (const [index, id] of data.imageIds.entries()) {
      await tx
        .update(productImages)
        .set({ position: index })
        .where(eq(productImages.id, id));
    }
  });

  revalidatePath(`/dashboard/${data.storeId}/products/${data.productId}`);
  revalidatePath(`/p/${owned.slug}`);
  return { ok: true, message: "Reordered." };
}

const tagSchema = z.object({
  storeId: z.uuid(),
  productId: z.uuid(),
  imageId: z.uuid(),
  valueIds: z.array(z.uuid()).max(8),
});

/**
 * Pins an image to attribute values.
 *
 * An image matches when every value it carries is satisfied by the shopper's
 * current selection, and the most specific match wins — so a general Navy photo
 * still works before a size is chosen, and a Navy/Large photo takes over as
 * soon as one is. Tagging nothing makes it a general product photo.
 */
export async function tagProductImageAction(
  input: z.input<typeof tagSchema>,
): Promise<ImageResult> {
  const parsed = tagSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid tags." };
  const data = parsed.data;

  await requireStorePermission(data.storeId, "product.update");
  const owned = await ownedProduct(data.productId, data.storeId);
  if (!owned) return { ok: false, message: "Product not found." };

  const [image] = await db
    .select({ id: productImages.id })
    .from(productImages)
    .where(
      and(
        eq(productImages.id, data.imageId),
        eq(productImages.productId, data.productId),
      ),
    )
    .limit(1);
  if (!image) return { ok: false, message: "Image not found." };

  // attributeId is part of this table's primary key, so it has to come from
  // the lookup rather than the request — and that key is what enforces one
  // value per attribute per image at the database level.
  let offered: { valueId: string; attributeId: string }[] = [];

  if (data.valueIds.length > 0) {
    // Only values this product actually offers. Tagging a photo with a colour
    // the product does not come in would make it unreachable — no selection
    // could ever match it.
    offered = await db
      .select({
        valueId: productAttributeValues.valueId,
        attributeId: productAttributeValues.attributeId,
      })
      .from(productAttributeValues)
      .where(
        and(
          eq(productAttributeValues.productId, data.productId),
          inArray(productAttributeValues.valueId, data.valueIds),
        ),
      );

    if (offered.length !== new Set(data.valueIds).size) {
      return {
        ok: false,
        message: "One of those values is not offered by this product.",
      };
    }

    // Two values from the same attribute cannot both be satisfied at once, so
    // an image tagged Navy AND Charcoal would never show.
    const attributeIds = offered.map((row) => row.attributeId);
    if (new Set(attributeIds).size !== attributeIds.length) {
      return {
        ok: false,
        message: "Pick at most one value per option, or the photo never shows.",
      };
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(productImageAttributeValues)
      .where(eq(productImageAttributeValues.imageId, data.imageId));

    if (data.valueIds.length > 0) {
      await tx.insert(productImageAttributeValues).values(
        offered.map((row) => ({
          imageId: data.imageId,
          attributeId: row.attributeId,
          valueId: row.valueId,
        })),
      );
    }
  });

  revalidatePath(`/dashboard/${data.storeId}/products/${data.productId}`);
  revalidatePath(`/p/${owned.slug}`);
  return {
    ok: true,
    message:
      data.valueIds.length === 0
        ? "Now a general photo."
        : "Tagged. It will show when those options are picked.",
  };
}
