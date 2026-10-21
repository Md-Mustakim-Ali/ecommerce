"use server";

import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireStorePermission } from "@/lib/auth/access";
import { slugify } from "@/lib/catalog/normalize";
import { db } from "@/lib/db";
import {
  brands,
  products,
  productTags,
  productVariants,
  tags,
} from "@/lib/db/schema";
import {
  type CreateProductInput,
  createProductSchema,
  priceToCents,
} from "@/lib/validation/product";

export type CreateProductResult =
  | { ok: true; productId: string }
  | { ok: false; message: string };

export async function createProductAction(
  input: CreateProductInput,
): Promise<CreateProductResult> {
  const parsed = createProductSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  // Ownership is verified server-side on every mutation. The client is assumed
  // hostile: a storeId in the payload proves nothing.
  await requireStorePermission(data.storeId, "product.create");

  // Publishing is a separate permission from creating, so a Catalog-only role
  // can draft but not push live.
  if (data.publish) {
    await requireStorePermission(data.storeId, "product.publish");
  }

  // Brand and tag ids come from the client too, so confirm they exist and are
  // usable before writing them onto a product.
  const brand = data.brandId
    ? await db.query.brands.findFirst({
        where: eq(brands.id, data.brandId),
        columns: { id: true, name: true, status: true },
      })
    : null;

  if (data.brandId && !brand) {
    return { ok: false, message: "That brand no longer exists." };
  }
  if (brand && (brand.status === "rejected" || brand.status === "merged")) {
    return {
      ok: false,
      message: `"${brand.name}" is no longer available. Pick another brand.`,
    };
  }

  const selectedTags = data.tagIds.length
    ? await db
        .select({ id: tags.id, name: tags.name, status: tags.status })
        .from(tags)
        .where(inArray(tags.id, data.tagIds))
    : [];

  const usableTags = selectedTags.filter(
    (t) => t.status === "approved" || t.status === "pending",
  );

  const baseSlug = slugify(data.title);
  if (baseSlug.length === 0) {
    return {
      ok: false,
      message: "That title needs at least one letter or number.",
    };
  }

  // Denormalised for the generated tsvector, which can only read its own row.
  const searchKeywords = [brand?.name, ...usableTags.map((t) => t.name)]
    .filter(Boolean)
    .join(" ");

  try {
    // One transaction: a product without its variant is not a sellable thing,
    // and half-created listings are worse than a failed request.
    const productId = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(products)
        .values({
          storeId: data.storeId,
          brandId: brand?.id ?? null,
          categoryId: data.categoryId,
          title: data.title,
          // (store_id, slug) is unique. Suffixing keeps two products with the
          // same title in one store from colliding.
          slug: `${baseSlug}-${Date.now().toString(36)}`,
          description: data.description || null,
          status: data.publish ? "active" : "draft",
          publishedAt: data.publish ? new Date() : null,
          searchKeywords,
        })
        .returning({ id: products.id });

      // Every product gets at least one variant, even with no options. It
      // keeps the checkout code from branching on "does this have variants".
      await tx.insert(productVariants).values({
        productId: created.id,
        sku: data.sku,
        optionValues: {},
        priceCents: priceToCents(data.price),
        stock: data.stock,
        position: 0,
      });

      if (usableTags.length > 0) {
        await tx
          .insert(productTags)
          .values(
            usableTags.map((tag) => ({ productId: created.id, tagId: tag.id })),
          );
      }

      return created.id;
    });

    revalidatePath(`/dashboard/${data.storeId}`);
    return { ok: true, productId };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}
