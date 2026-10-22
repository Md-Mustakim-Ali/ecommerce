"use server";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePlatformPermission } from "@/lib/auth/access";
import { getSession } from "@/lib/auth/guards";
import { slugify } from "@/lib/catalog/normalize";
import { db } from "@/lib/db";
import {
  attributes,
  attributeValues,
  auditLog,
  categories,
  orders,
  products,
  reviews,
  session as sessionTable,
  stores,
  user,
} from "@/lib/db/schema";

/**
 * Platform moderation.
 *
 * Everything here is an action taken on somebody else's content or account, so
 * every one of them records who did it and why. An audit entry is not
 * paperwork — when a seller asks why their listing disappeared, this is the
 * only thing that can answer, and a moderation tool without one is a tool
 * nobody can defend.
 */

export type ModerationResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

async function actor() {
  const session = await getSession();
  if (!session) return null;
  return { id: session.user.id, email: session.user.email };
}

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

/**
 * Attributes and values awaiting review.
 *
 * Sellers can add a value inline while editing a product — blocking a listing
 * behind moderation for a colour name is how the field stops being used — so
 * these arrive already in use. Review is about merging duplicates after the
 * fact, not gatekeeping before.
 */
export async function pendingAttributesAction() {
  await requirePlatformPermission("platform.attribute.review");

  const [pendingAttrs, recentValues] = await Promise.all([
    db
      .select({
        id: attributes.id,
        name: attributes.name,
        slug: attributes.slug,
        kind: attributes.kind,
        unit: attributes.unit,
        createdAt: attributes.createdAt,
        usage: sql<number>`(
          select count(*)::int from product_attributes pa
          where pa.attribute_id = ${attributes.id}
        )`,
      })
      .from(attributes)
      .where(eq(attributes.status, "pending"))
      .orderBy(desc(attributes.createdAt)),

    // Values created recently, with near-matches inside the same attribute.
    // A duplicate colour is far more common than a duplicate attribute.
    db
      .select({
        id: attributeValues.id,
        value: attributeValues.value,
        slug: attributeValues.slug,
        attributeId: attributeValues.attributeId,
        attributeName: attributes.name,
        createdAt: attributeValues.createdAt,
        usage: sql<number>`(
          select count(*)::int from product_attribute_values pav
          where pav.value_id = ${attributeValues.id}
        )`,
      })
      .from(attributeValues)
      .innerJoin(attributes, eq(attributes.id, attributeValues.attributeId))
      .where(sql`${attributeValues.createdBy} is not null`)
      .orderBy(desc(attributeValues.createdAt))
      .limit(60),
  ]);

  // Near-matches per value, so a reviewer sees "Navy Blue" next to "Navy"
  // rather than having to notice it.
  const similar = await db.execute<{
    id: string;
    other_id: string;
    other_value: string;
    similarity: number;
  }>(sql`
    select a.id, b.id as other_id, b.value as other_value,
           similarity(a.value, b.value) as similarity
    from attribute_values a
    join attribute_values b
      on b.attribute_id = a.attribute_id
     and b.id <> a.id
     and b.status = 'approved'
    where a.created_by is not null
      and similarity(a.value, b.value) > 0.45
    order by similarity desc
    limit 200
  `);

  const byValue = new Map<string, { id: string; value: string }[]>();
  for (const row of similar) {
    const list = byValue.get(row.id) ?? [];
    list.push({ id: row.other_id, value: row.other_value });
    byValue.set(row.id, list);
  }

  return {
    attributes: pendingAttrs,
    values: recentValues.map((value) => ({
      ...value,
      similar: byValue.get(value.id) ?? [],
    })),
  };
}

const mergeValueSchema = z.object({
  valueId: z.uuid(),
  intoValueId: z.uuid(),
});

/**
 * Merges a duplicate value into the canonical one.
 *
 * Everything pointing at the duplicate is repointed first, then the duplicate
 * is marked merged rather than deleted — the id may be sitting in somebody's
 * bookmarked filter URL, and `merged_into_id` lets that still resolve.
 */
export async function mergeAttributeValueAction(
  input: z.input<typeof mergeValueSchema>,
): Promise<ModerationResult> {
  const parsed = mergeValueSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid merge." };
  const { valueId, intoValueId } = parsed.data;

  if (valueId === intoValueId) {
    return { ok: false, message: "Cannot merge a value into itself." };
  }

  await requirePlatformPermission("platform.attribute.review");
  const who = await actor();
  if (!who) return { ok: false, message: "Not signed in." };

  const rows = await db
    .select({
      id: attributeValues.id,
      value: attributeValues.value,
      attributeId: attributeValues.attributeId,
      status: attributeValues.status,
    })
    .from(attributeValues)
    .where(sql`${attributeValues.id} in (${valueId}, ${intoValueId})`);

  const from = rows.find((r) => r.id === valueId);
  const into = rows.find((r) => r.id === intoValueId);
  if (!from || !into) return { ok: false, message: "Value not found." };

  // Merging across attributes would file Navy under Size.
  if (from.attributeId !== into.attributeId) {
    return {
      ok: false,
      message: "Both values have to belong to the same attribute.",
    };
  }

  await db.transaction(async (tx) => {
    // Repointed with ON CONFLICT DO NOTHING because a product may already
    // offer both — merging then leaves it offering the survivor once.
    await tx.execute(sql`
      update product_attribute_values set value_id = ${intoValueId}
      where value_id = ${valueId}
        and not exists (
          select 1 from product_attribute_values x
          where x.product_id = product_attribute_values.product_id
            and x.value_id = ${intoValueId}
        )
    `);
    await tx.execute(
      sql`delete from product_attribute_values where value_id = ${valueId}`,
    );

    await tx.execute(sql`
      update variant_attribute_values set value_id = ${intoValueId}
      where value_id = ${valueId}
    `);
    await tx.execute(sql`
      update product_image_attribute_values set value_id = ${intoValueId}
      where value_id = ${valueId}
    `);

    await tx
      .update(attributeValues)
      .set({ status: "merged", mergedIntoId: intoValueId })
      .where(eq(attributeValues.id, valueId));

    await tx.insert(auditLog).values({
      storeId: null,
      actorId: who.id,
      actorEmail: who.email,
      action: "platform.attribute.merge",
      targetType: "attribute_value",
      targetId: valueId,
      targetLabel: from.value,
      before: { value: from.value },
      after: { mergedInto: into.value },
    });
  });

  revalidatePath("/admin/catalog");
  return { ok: true, message: `Merged "${from.value}" into "${into.value}".` };
}

export async function reviewAttributeAction(input: {
  attributeId: string;
  decision: "approved" | "rejected";
  reason?: string;
}): Promise<ModerationResult> {
  const attributeId = z.uuid().parse(input.attributeId);
  const decision = z.enum(["approved", "rejected"]).parse(input.decision);

  await requirePlatformPermission("platform.attribute.review");
  const who = await actor();
  if (!who) return { ok: false, message: "Not signed in." };

  if (decision === "rejected" && !input.reason) {
    return { ok: false, message: "Give a reason when rejecting." };
  }

  const [attribute] = await db
    .select({ id: attributes.id, name: attributes.name })
    .from(attributes)
    .where(eq(attributes.id, attributeId))
    .limit(1);
  if (!attribute) return { ok: false, message: "Attribute not found." };

  await db.transaction(async (tx) => {
    await tx
      .update(attributes)
      .set({
        status: decision,
        approvedBy: decision === "approved" ? who.id : null,
        approvedAt: decision === "approved" ? new Date() : null,
        rejectionReason: input.reason ?? null,
      })
      .where(eq(attributes.id, attributeId));

    await tx.insert(auditLog).values({
      storeId: null,
      actorId: who.id,
      actorEmail: who.email,
      action: `platform.attribute.${decision}`,
      targetType: "attribute",
      targetId: attributeId,
      targetLabel: attribute.name,
      before: { status: "pending" },
      after: { status: decision, reason: input.reason ?? null },
    });
  });

  revalidatePath("/admin/catalog");
  return { ok: true, message: `${attribute.name} ${decision}.` };
}

// ---------------------------------------------------------------------------
// Products and reviews
// ---------------------------------------------------------------------------

export async function moderateProductAction(input: {
  productId: string;
  reason: string;
}): Promise<ModerationResult> {
  const productId = z.uuid().parse(input.productId);
  const reason = z
    .string()
    .trim()
    .min(4, "Give a reason")
    .max(300)
    .parse(input.reason);

  await requirePlatformPermission("platform.product.moderate");
  const who = await actor();
  if (!who) return { ok: false, message: "Not signed in." };

  const [product] = await db
    .select({
      id: products.id,
      title: products.title,
      slug: products.slug,
      status: products.status,
      storeId: products.storeId,
    })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  if (!product) return { ok: false, message: "Product not found." };

  // Archived, not deleted. Past orders reference the variant, and the seller
  // needs the listing back if the takedown was wrong.
  await db.transaction(async (tx) => {
    await tx
      .update(products)
      .set({ status: "archived", publishedAt: null })
      .where(eq(products.id, productId));

    await tx.insert(auditLog).values({
      storeId: product.storeId,
      actorId: who.id,
      actorEmail: who.email,
      action: "platform.product.moderate",
      targetType: "product",
      targetId: productId,
      targetLabel: product.title,
      before: { status: product.status },
      after: { status: "archived", reason },
    });
  });

  revalidatePath("/admin/moderation");
  revalidatePath(`/p/${product.slug}`);
  return { ok: true, message: `${product.title} taken down.` };
}

export async function moderateReviewAction(input: {
  reviewId: string;
  status: "published" | "flagged" | "removed";
  reason?: string;
}): Promise<ModerationResult> {
  const reviewId = z.uuid().parse(input.reviewId);
  const status = z
    .enum(["published", "flagged", "removed"])
    .parse(input.status);

  await requirePlatformPermission("platform.review.moderate");
  const who = await actor();
  if (!who) return { ok: false, message: "Not signed in." };

  if (status === "removed" && !input.reason) {
    return { ok: false, message: "Give a reason when removing a review." };
  }

  const [review] = await db
    .select({
      id: reviews.id,
      status: reviews.status,
      productId: reviews.productId,
      title: reviews.title,
      slug: products.slug,
    })
    .from(reviews)
    .innerJoin(products, eq(products.id, reviews.productId))
    .where(eq(reviews.id, reviewId))
    .limit(1);
  if (!review) return { ok: false, message: "Review not found." };

  await db.transaction(async (tx) => {
    await tx.update(reviews).set({ status }).where(eq(reviews.id, reviewId));

    await tx.insert(auditLog).values({
      storeId: null,
      actorId: who.id,
      actorEmail: who.email,
      action: `platform.review.${status}`,
      targetType: "review",
      targetId: reviewId,
      targetLabel: review.title,
      before: { status: review.status },
      after: { status, reason: input.reason ?? null },
    });
  });

  revalidatePath("/admin/moderation");
  revalidatePath(`/p/${review.slug}`);
  return {
    ok: true,
    message:
      status === "removed"
        ? "Removed. It no longer counts toward the rating."
        : status === "flagged"
          ? "Flagged."
          : "Restored.",
  };
}

/** Products and reviews a moderator might want to look at. */
export async function moderationQueueAction() {
  await requirePlatformPermission("platform.product.moderate");

  const [recentProducts, flaggedReviews] = await Promise.all([
    db
      .select({
        id: products.id,
        title: products.title,
        slug: products.slug,
        status: products.status,
        storeName: stores.name,
        createdAt: products.createdAt,
      })
      .from(products)
      .innerJoin(stores, eq(stores.id, products.storeId))
      .where(eq(products.status, "active"))
      .orderBy(desc(products.createdAt))
      .limit(30),

    db
      .select({
        id: reviews.id,
        rating: reviews.rating,
        title: reviews.title,
        body: reviews.body,
        status: reviews.status,
        createdAt: reviews.createdAt,
        productTitle: products.title,
        productSlug: products.slug,
        authorName: user.name,
      })
      .from(reviews)
      .innerJoin(products, eq(products.id, reviews.productId))
      .innerJoin(user, eq(user.id, reviews.buyerId))
      // Flagged first, then anything low-rated, which is where complaints land.
      .where(sql`${reviews.status} <> 'published' or ${reviews.rating} <= 2`)
      .orderBy(
        sql`case when ${reviews.status} = 'flagged' then 0 else 1 end`,
        desc(reviews.createdAt),
      )
      .limit(40),
  ]);

  return { products: recentProducts, reviews: flaggedReviews };
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function searchUsersAction(input: { query: string }) {
  await requirePlatformPermission("platform.user.view");
  const query = z.string().trim().max(120).parse(input.query);

  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(
      query.length === 0
        ? sql`true`
        : sql`${user.email} ilike ${`%${query}%`} or ${user.name} ilike ${`%${query}%`}`,
    )
    .orderBy(desc(user.createdAt))
    .limit(40);

  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);

  // Counted in their own grouped queries rather than correlated subqueries.
  // Drizzle emits an outer column reference inside a raw sql template
  // unqualified, so `user.id` becomes a bare "id" that binds to whichever
  // table the subquery selects from — here it compared stores.owner_id
  // against stores.id and failed on the type mismatch. See
  // docs/backend-ui-gaps.md.
  const [storeCounts, orderCounts, sessionCounts] = await Promise.all([
    db
      .select({ ownerId: stores.ownerId, count: sql<number>`count(*)::int` })
      .from(stores)
      .where(inArray(stores.ownerId, ids))
      .groupBy(stores.ownerId),
    db
      .select({ buyerId: orders.buyerId, count: sql<number>`count(*)::int` })
      .from(orders)
      .where(inArray(orders.buyerId, ids))
      .groupBy(orders.buyerId),
    db
      .select({
        userId: sessionTable.userId,
        count: sql<number>`count(*)::int`,
      })
      .from(sessionTable)
      .where(
        and(
          inArray(sessionTable.userId, ids),
          sql`${sessionTable.expiresAt} > now()`,
        ),
      )
      .groupBy(sessionTable.userId),
  ]);

  const byStore = new Map(storeCounts.map((r) => [r.ownerId, r.count]));
  const byOrder = new Map(
    orderCounts
      .filter((r): r is typeof r & { buyerId: string } => r.buyerId !== null)
      .map((r) => [r.buyerId, r.count]),
  );
  const bySession = new Map(sessionCounts.map((r) => [r.userId, r.count]));

  return rows.map((row) => ({
    ...row,
    storeCount: byStore.get(row.id) ?? 0,
    orderCount: byOrder.get(row.id) ?? 0,
    // There is no suspended column on the Better Auth user table. Active
    // sessions is the honest signal: suspending revokes them, so zero means
    // the account cannot currently act.
    activeSessions: bySession.get(row.id) ?? 0,
  }));
}

/**
 * Suspends an account by revoking every session.
 *
 * There is no `suspended` column on the Better Auth user table and adding one
 * would not stop an existing session — the cookie is already signed and the
 * session row is what authorises it. Deleting the sessions is what actually
 * ends access, immediately.
 */
export async function suspendUserAction(input: {
  userId: string;
  reason: string;
}): Promise<ModerationResult> {
  const userId = z.string().min(1).parse(input.userId);
  const reason = z
    .string()
    .trim()
    .min(4, "Give a reason")
    .max(300)
    .parse(input.reason);

  await requirePlatformPermission("platform.user.suspend");
  const who = await actor();
  if (!who) return { ok: false, message: "Not signed in." };

  if (userId === who.id) {
    return { ok: false, message: "You cannot suspend your own account." };
  }

  const [target] = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!target) return { ok: false, message: "User not found." };

  const revoked = await db
    .delete(sessionTable)
    .where(eq(sessionTable.userId, userId))
    .returning({ id: sessionTable.id });

  await db.insert(auditLog).values({
    storeId: null,
    actorId: who.id,
    actorEmail: who.email,
    action: "platform.user.suspend",
    targetType: "user",
    targetId: userId,
    targetLabel: target.email,
    before: null,
    after: { reason, sessionsRevoked: revoked.length },
  });

  revalidatePath("/admin/users");
  return {
    ok: true,
    message: `Signed ${target.email} out of ${revoked.length} ${revoked.length === 1 ? "session" : "sessions"}.`,
  };
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function categoryTreeAction() {
  await requirePlatformPermission("platform.category.manage");

  return db
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      parentId: categories.parentId,
      position: categories.position,
      productCount: sql<number>`(
        select count(*)::int from products p where p.category_id = ${categories.id}
      )`,
    })
    .from(categories)
    .orderBy(categories.position, categories.name);
}

const categorySchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2, "Give the category a name").max(80),
  parentId: z.uuid().nullable(),
});

export async function saveCategoryAction(
  input: z.input<typeof categorySchema>,
): Promise<ModerationResult> {
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  await requirePlatformPermission("platform.category.manage");
  const who = await actor();
  if (!who) return { ok: false, message: "Not signed in." };

  const slug = slugify(data.name);
  if (!slug)
    return { ok: false, message: "That name needs a letter or number." };

  // A category that is its own ancestor makes the tree walk in
  // categoryPerformance loop forever.
  if (data.id && data.parentId) {
    const ancestors = await db.execute<{ id: string }>(sql`
      with recursive up as (
        select id, parent_id from categories where id = ${data.parentId}
        union all
        select c.id, c.parent_id from categories c join up on up.parent_id = c.id
      )
      select id from up
    `);
    if (ancestors.some((row) => row.id === data.id)) {
      return {
        ok: false,
        message: "That would make the category its own parent.",
      };
    }
  }

  const [clash] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.slug, slug),
        data.id ? sql`${categories.id} <> ${data.id}` : sql`true`,
      ),
    )
    .limit(1);
  if (clash) return { ok: false, message: `/${slug} is already taken.` };

  if (data.id) {
    await db
      .update(categories)
      .set({ name: data.name, slug, parentId: data.parentId })
      .where(eq(categories.id, data.id));
  } else {
    await db
      .insert(categories)
      .values({ name: data.name, slug, parentId: data.parentId });
  }

  await db.insert(auditLog).values({
    storeId: null,
    actorId: who.id,
    actorEmail: who.email,
    action: data.id ? "platform.category.update" : "platform.category.create",
    targetType: "category",
    targetId: data.id ?? slug,
    targetLabel: data.name,
    before: null,
    after: { name: data.name, slug, parentId: data.parentId },
  });

  revalidatePath("/admin/categories");
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: data.id ? "Category updated." : "Category added.",
  };
}

export async function deleteCategoryAction(input: {
  categoryId: string;
}): Promise<ModerationResult> {
  const categoryId = z.uuid().parse(input.categoryId);

  await requirePlatformPermission("platform.category.manage");
  const who = await actor();
  if (!who) return { ok: false, message: "Not signed in." };

  const [category] = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .limit(1);
  if (!category) return { ok: false, message: "Category not found." };

  // Products reference it, and children hang off it. Deleting either out from
  // under them silently strands listings nobody can find.
  const [{ products: productCount, children }] = await db
    .select({
      products: sql<number>`(
        select count(*)::int from products p where p.category_id = ${categoryId}
      )`,
      children: sql<number>`(
        select count(*)::int from categories c where c.parent_id = ${categoryId}
      )`,
    })
    .from(sql`(select 1) as _`);

  if (productCount > 0) {
    return {
      ok: false,
      message: `${productCount} ${productCount === 1 ? "product is" : "products are"} in this category. Move them first.`,
    };
  }
  if (children > 0) {
    return {
      ok: false,
      message: `It has ${children} ${children === 1 ? "subcategory" : "subcategories"}. Remove them first.`,
    };
  }

  await db.delete(categories).where(eq(categories.id, categoryId));

  await db.insert(auditLog).values({
    storeId: null,
    actorId: who.id,
    actorEmail: who.email,
    action: "platform.category.delete",
    targetType: "category",
    targetId: categoryId,
    targetLabel: category.name,
    before: { name: category.name },
    after: null,
  });

  revalidatePath("/admin/categories");
  revalidatePath("/", "layout");
  return { ok: true, message: `${category.name} removed.` };
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/** Every privileged action, platform-wide. */
export async function platformAuditAction(input: { limit?: number } = {}) {
  await requirePlatformPermission("platform.audit.view");
  const limit = Math.min(200, input.limit ?? 100);

  return db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      actorEmail: auditLog.actorEmail,
      targetType: auditLog.targetType,
      targetLabel: auditLog.targetLabel,
      before: auditLog.before,
      after: auditLog.after,
      createdAt: auditLog.createdAt,
      storeName: stores.name,
    })
    .from(auditLog)
    .leftJoin(stores, eq(stores.id, auditLog.storeId))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}

/** Orders across every store, for support lookups. */
export async function allOrdersAction(input: { query?: string } = {}) {
  await requirePlatformPermission("platform.order.view");
  const query = z.string().trim().max(120).optional().parse(input.query);

  return db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      email: orders.email,
      status: orders.status,
      totalCents: orders.totalCents,
      currency: orders.currency,
      placedAt: orders.placedAt,
      storeCount: sql<number>`(
        select count(*)::int from sub_orders so where so.order_id = ${orders.id}
      )`,
    })
    .from(orders)
    .where(
      query
        ? sql`${orders.orderNumber} ilike ${`%${query}%`} or ${orders.email} ilike ${`%${query}%`}`
        : sql`true`,
    )
    .orderBy(desc(orders.placedAt))
    .limit(60);
}
