"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStorePermission } from "@/lib/auth/access";
import { getSession } from "@/lib/auth/guards";
import { slugify } from "@/lib/catalog/normalize";
import { db } from "@/lib/db";
import {
  attributes,
  attributeValues,
  productAttributes,
  productAttributeValues,
  products,
  productVariants,
  variantAttributeValues,
} from "@/lib/db/schema";

/**
 * Authoring products: attributes, values, and the variant matrix.
 *
 * The rule that shapes all of it: the set of variants IS the set of valid
 * combinations. There is no table of allowed pairings, so making a combination
 * invalid means deleting its variant, and offering one means creating it.
 * Saving the matrix is therefore a diff, not a rewrite — a wholesale
 * delete-and-reinsert would orphan every order item pointing at a variant and
 * throw away its stock.
 */

export type EditorResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

const money = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Use a price like 19.99");

/** Money is parsed from a decimal string, never a float. */
function toCents(value: string): number {
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
}

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

const detailsSchema = z.object({
  storeId: z.uuid(),
  productId: z.uuid(),
  title: z.string().trim().min(2, "Give the product a title").max(140),
  description: z.string().trim().max(8000).optional(),
  stockDisplay: z.enum(["never", "always", "when_low"]),
  lowStockThreshold: z.coerce.number().int().min(0).max(10_000),
});

export async function updateProductDetailsAction(
  input: z.input<typeof detailsSchema>,
): Promise<EditorResult> {
  const parsed = detailsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  await requireStorePermission(data.storeId, "product.update");
  const owned = await ownedProduct(data.productId, data.storeId);
  if (!owned) return { ok: false, message: "Product not found." };

  await db
    .update(products)
    .set({
      title: data.title,
      description: data.description || null,
      stockDisplay: data.stockDisplay,
      lowStockThreshold: data.lowStockThreshold,
    })
    .where(eq(products.id, data.productId));

  revalidatePath(`/dashboard/${data.storeId}/products/${data.productId}`);
  revalidatePath(`/p/${owned.slug}`);
  return { ok: true, message: "Saved." };
}

export async function setProductStatusAction(input: {
  storeId: string;
  productId: string;
  status: "draft" | "active" | "archived";
}): Promise<EditorResult> {
  const storeId = z.uuid().parse(input.storeId);
  const productId = z.uuid().parse(input.productId);
  const status = z.enum(["draft", "active", "archived"]).parse(input.status);

  // Publishing is its own permission, so a catalog role can draft but not go
  // live. Archiving is the same power in reverse and is gated with it.
  await requireStorePermission(
    storeId,
    status === "active" ? "product.publish" : "product.archive",
  );

  const owned = await ownedProduct(productId, storeId);
  if (!owned) return { ok: false, message: "Product not found." };

  if (status === "active") {
    // A live product with no priced variant is a listing that cannot be
    // bought. Better to refuse than to publish something broken.
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(productVariants)
      .where(eq(productVariants.productId, productId));

    if (count === 0) {
      return {
        ok: false,
        message: "Add at least one variant before publishing.",
      };
    }
  }

  await db
    .update(products)
    .set({
      status,
      publishedAt: status === "active" ? new Date() : null,
    })
    .where(eq(products.id, productId));

  revalidatePath(`/dashboard/${storeId}/products`);
  revalidatePath(`/p/${owned.slug}`);
  return {
    ok: true,
    message:
      status === "active"
        ? "Published."
        : status === "archived"
          ? "Archived."
          : "Moved to draft.",
  };
}

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

const attributesSchema = z.object({
  storeId: z.uuid(),
  productId: z.uuid(),
  attributes: z
    .array(
      z.object({
        attributeId: z.uuid(),
        role: z.enum(["variant", "spec"]),
        valueIds: z.array(z.uuid()).max(60),
      }),
    )
    .max(12),
});

/**
 * Sets which attributes this product uses and which values it offers.
 *
 * Removing a value the variant matrix still references would leave variants
 * pointing at options the product no longer claims, so those variants go too —
 * stated explicitly in the response rather than done silently.
 */
export async function setProductAttributesAction(
  input: z.input<typeof attributesSchema>,
): Promise<EditorResult> {
  const parsed = attributesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  await requireStorePermission(data.storeId, "variant.manage");
  const owned = await ownedProduct(data.productId, data.storeId);
  if (!owned) return { ok: false, message: "Product not found." };

  // Every id off the wire is checked against the approved vocabulary. A
  // pending or rejected value must not reach a live product.
  const attributeIds = data.attributes.map((a) => a.attributeId);
  const valueIds = data.attributes.flatMap((a) => a.valueIds);

  if (attributeIds.length > 0) {
    const found = await db
      .select({ id: attributes.id })
      .from(attributes)
      .where(
        and(
          inArray(attributes.id, attributeIds),
          eq(attributes.status, "approved"),
        ),
      );
    if (found.length !== new Set(attributeIds).size) {
      return {
        ok: false,
        message: "One of those attributes is not available.",
      };
    }
  }

  if (valueIds.length > 0) {
    const found = await db
      .select({
        id: attributeValues.id,
        attributeId: attributeValues.attributeId,
      })
      .from(attributeValues)
      .where(
        and(
          inArray(attributeValues.id, valueIds),
          eq(attributeValues.status, "approved"),
        ),
      );

    if (found.length !== new Set(valueIds).size) {
      return { ok: false, message: "One of those values is not available." };
    }

    // A value has to belong to the attribute it was submitted under, or the
    // matrix ends up with Navy filed as a Size.
    const ownerOf = new Map(found.map((row) => [row.id, row.attributeId]));
    for (const entry of data.attributes) {
      for (const valueId of entry.valueIds) {
        if (ownerOf.get(valueId) !== entry.attributeId) {
          return {
            ok: false,
            message: "A value does not belong to its attribute.",
          };
        }
      }
    }
  }

  const keptValues = new Set(valueIds);
  let droppedVariants = 0;

  await db.transaction(async (tx) => {
    await tx
      .delete(productAttributes)
      .where(eq(productAttributes.productId, data.productId));
    await tx
      .delete(productAttributeValues)
      .where(eq(productAttributeValues.productId, data.productId));

    if (data.attributes.length > 0) {
      await tx.insert(productAttributes).values(
        data.attributes.map((entry, index) => ({
          productId: data.productId,
          attributeId: entry.attributeId,
          role: entry.role,
          position: index,
        })),
      );

      const valueRows = data.attributes.flatMap((entry) =>
        entry.valueIds.map((valueId) => ({
          productId: data.productId,
          attributeId: entry.attributeId,
          valueId,
        })),
      );
      if (valueRows.length > 0) {
        await tx.insert(productAttributeValues).values(valueRows);
      }
    }

    // Any variant referencing a value the product no longer offers.
    const orphaned = await tx
      .select({
        variantId: variantAttributeValues.variantId,
        valueId: variantAttributeValues.valueId,
      })
      .from(variantAttributeValues)
      .innerJoin(
        productVariants,
        eq(productVariants.id, variantAttributeValues.variantId),
      )
      .where(eq(productVariants.productId, data.productId));

    const doomed = [
      ...new Set(
        orphaned
          .filter((row) => !keptValues.has(row.valueId))
          .map((row) => row.variantId),
      ),
    ];

    if (doomed.length > 0) {
      // set null on order_items.variant_id keeps past orders readable; they
      // render from their own snapshot columns regardless.
      await tx
        .delete(productVariants)
        .where(inArray(productVariants.id, doomed));
      droppedVariants = doomed.length;
    }
  });

  revalidatePath(`/dashboard/${data.storeId}/products/${data.productId}`);
  revalidatePath(`/p/${owned.slug}`);

  return {
    ok: true,
    message:
      droppedVariants > 0
        ? `Saved. ${droppedVariants} ${droppedVariants === 1 ? "combination" : "combinations"} no longer valid and were removed.`
        : "Saved.",
  };
}

// ---------------------------------------------------------------------------
// The variant matrix
// ---------------------------------------------------------------------------

const variantsSchema = z.object({
  storeId: z.uuid(),
  productId: z.uuid(),
  variants: z
    .array(
      z.object({
        /** Absent for a row the seller has just added. */
        id: z.uuid().optional(),
        sku: z.string().trim().max(64).optional(),
        price: money,
        compareAtPrice: money.optional().or(z.literal("")),
        stock: z.coerce.number().int().min(0).max(1_000_000),
        /** attributeId -> valueId. Empty for a product with no options. */
        combination: z.record(z.uuid(), z.uuid()),
      }),
    )
    .min(1, "A product needs at least one variant")
    .max(400),
});

/**
 * Saves the whole matrix as a diff.
 *
 * Rows the seller deleted are the invalid combinations — that is the entire
 * mechanism. Rows that survive keep their id, and therefore their stock and
 * their link from past order items.
 */
export async function saveVariantsAction(
  input: z.input<typeof variantsSchema>,
): Promise<EditorResult> {
  const parsed = variantsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  await requireStorePermission(data.storeId, "variant.manage");
  const owned = await ownedProduct(data.productId, data.storeId);
  if (!owned) return { ok: false, message: "Product not found." };

  // Two variants with the same combination would make the option picker
  // ambiguous: choosing Navy/Large could resolve to either price.
  const seen = new Set<string>();
  for (const variant of data.variants) {
    const key = Object.entries(variant.combination)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join("|");
    if (seen.has(key)) {
      return { ok: false, message: "Two rows have the same combination." };
    }
    seen.add(key);
  }

  const skus = data.variants
    .map((v) => v.sku?.trim())
    .filter((s): s is string => Boolean(s));
  if (new Set(skus).size !== skus.length) {
    return { ok: false, message: "Two rows have the same SKU." };
  }

  for (const variant of data.variants) {
    if (variant.compareAtPrice && variant.compareAtPrice !== "") {
      if (toCents(variant.compareAtPrice) <= toCents(variant.price)) {
        return {
          ok: false,
          message:
            "A compare-at price has to be above the price, or the saving reads as negative.",
        };
      }
    }
  }

  const existing = await db
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(eq(productVariants.productId, data.productId));

  const existingIds = new Set(existing.map((row) => row.id));
  const keptIds = new Set(
    data.variants.map((v) => v.id).filter((id): id is string => Boolean(id)),
  );

  // An id the client sent that is not on this product is an attempt to edit
  // somebody else's row.
  for (const id of keptIds) {
    if (!existingIds.has(id)) {
      return { ok: false, message: "One of those variants no longer exists." };
    }
  }

  const removed = [...existingIds].filter((id) => !keptIds.has(id));

  await db.transaction(async (tx) => {
    if (removed.length > 0) {
      await tx
        .delete(productVariants)
        .where(inArray(productVariants.id, removed));
    }

    for (const [index, variant] of data.variants.entries()) {
      // SKU is NOT NULL, and asking a seller to invent forty of them by hand
      // for a forty-row matrix is how the field gets filled with rubbish. A
      // generated one is unique, stable for the row, and replaceable.
      const sku =
        variant.sku?.trim() ||
        `${owned.slug.slice(0, 24).toUpperCase()}-${index.toString().padStart(3, "0")}`;

      const values = {
        sku,
        priceCents: toCents(variant.price),
        compareAtPriceCents:
          variant.compareAtPrice && variant.compareAtPrice !== ""
            ? toCents(variant.compareAtPrice)
            : null,
        stock: variant.stock,
        position: index,
        // Kept in step with variant_attribute_values so the storefront's
        // label ("12 GB / Navy") does not need a join to render.
        optionValues: variant.combination,
      };

      let variantId = variant.id;

      if (variantId) {
        await tx
          .update(productVariants)
          .set(values)
          .where(eq(productVariants.id, variantId));
        await tx
          .delete(variantAttributeValues)
          .where(eq(variantAttributeValues.variantId, variantId));
      } else {
        const [created] = await tx
          .insert(productVariants)
          .values({ productId: data.productId, ...values })
          .returning({ id: productVariants.id });
        variantId = created.id;
      }

      const rows = Object.entries(variant.combination).map(
        ([attributeId, valueId]) => ({ variantId, attributeId, valueId }),
      );
      if (rows.length > 0) {
        await tx.insert(variantAttributeValues).values(rows);
      }
    }
  });

  revalidatePath(`/dashboard/${data.storeId}/products/${data.productId}`);
  revalidatePath(`/p/${owned.slug}`);

  return {
    ok: true,
    message:
      removed.length > 0
        ? `Saved. ${removed.length} ${removed.length === 1 ? "combination" : "combinations"} removed.`
        : "Saved.",
  };
}

// ---------------------------------------------------------------------------
// Proposing new vocabulary
// ---------------------------------------------------------------------------

const proposeValueSchema = z.object({
  storeId: z.uuid(),
  attributeId: z.uuid(),
  value: z.string().trim().min(1, "Enter a value").max(80),
});

export type ProposeValueResult =
  | {
      ok: true;
      created: boolean;
      value: { id: string; value: string; slug: string };
    }
  | { ok: false; message: string; similar?: { id: string; value: string }[] };

/**
 * Adds a value to an existing attribute, deduplicated.
 *
 * The slug is the deduplication key, so "Navy", "navy" and " NAVY " resolve to
 * one row. A near-match is reported rather than blocked — "Navy Blue" beside
 * "Navy" may be a duplicate or may not, and only a person can say.
 */
export async function proposeAttributeValueAction(
  input: z.input<typeof proposeValueSchema>,
): Promise<ProposeValueResult> {
  const parsed = proposeValueSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  await requireStorePermission(data.storeId, "attribute.propose");
  const session = await getSession();
  if (!session) return { ok: false, message: "Not signed in." };

  const slug = slugify(data.value);
  if (!slug) {
    return { ok: false, message: "That value needs a letter or a number." };
  }

  const [attribute] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(
      and(
        eq(attributes.id, data.attributeId),
        eq(attributes.status, "approved"),
      ),
    )
    .limit(1);
  if (!attribute)
    return { ok: false, message: "That attribute is not available." };

  // Exact match on the slug: already exists, so hand it back rather than
  // creating a second one.
  const [exact] = await db
    .select({
      id: attributeValues.id,
      value: attributeValues.value,
      slug: attributeValues.slug,
    })
    .from(attributeValues)
    .where(
      and(
        eq(attributeValues.attributeId, data.attributeId),
        eq(attributeValues.slug, slug),
      ),
    )
    .limit(1);

  if (exact) return { ok: true, created: false, value: exact };

  const [created] = await db
    .insert(attributeValues)
    .values({
      attributeId: data.attributeId,
      value: data.value,
      slug,
      // Usable straight away, reviewable later. Blocking a listing behind
      // moderation for a colour name is how sellers stop using the field and
      // start putting the colour in the title.
      status: "approved",
      createdBy: session.user.id,
    })
    .returning({
      id: attributeValues.id,
      value: attributeValues.value,
      slug: attributeValues.slug,
    });

  return { ok: true, created: true, value: created };
}

/** Near-matches for a proposed value, so a seller can spot a duplicate first. */
export async function findSimilarValuesAction(input: {
  storeId: string;
  attributeId: string;
  query: string;
}): Promise<{ id: string; value: string; similarity: number }[]> {
  const storeId = z.uuid().parse(input.storeId);
  const attributeId = z.uuid().parse(input.attributeId);
  const query = z.string().trim().max(80).parse(input.query);

  await requireStorePermission(storeId, "attribute.propose");
  if (query.length < 2) return [];

  const rows = await db
    .select({
      id: attributeValues.id,
      value: attributeValues.value,
      similarity: sql<number>`similarity(${attributeValues.value}, ${query})`,
    })
    .from(attributeValues)
    .where(
      and(
        eq(attributeValues.attributeId, attributeId),
        eq(attributeValues.status, "approved"),
        sql`similarity(${attributeValues.value}, ${query}) > 0.3`,
      ),
    )
    .orderBy(sql`similarity(${attributeValues.value}, ${query}) desc`)
    .limit(5);

  return rows;
}

async function ownedProduct(productId: string, storeId: string) {
  const [row] = await db
    .select({ id: products.id, slug: products.slug })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.storeId, storeId)))
    .limit(1);
  return row ?? null;
}
