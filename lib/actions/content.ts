"use server";

import { and, eq, isNull, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  requirePlatformPermission,
  requireStorePermission,
} from "@/lib/auth/access";
import { getSession } from "@/lib/auth/guards";
import { slugify } from "@/lib/catalog/normalize";
import { validateBlockInput } from "@/lib/content/blocks";
import { db } from "@/lib/db";
import {
  auditLog,
  pageBlocks,
  pages,
  placements,
  placementTargets,
  STORE_ASSIGNABLE_SLOTS,
} from "@/lib/db/schema";

/**
 * Content actions for pages and placements.
 *
 * Every action is scoped: a store-scoped call checks the store permission for
 * that specific store, a platform-scoped call checks the platform permission.
 * A seller cannot create a platform page, and cannot touch another store's
 * content, because the scope is derived from the checked permission rather
 * than trusted from the payload.
 */

const scopeSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("platform") }),
  z.object({ scope: z.literal("store"), storeId: z.uuid() }),
]);

type Scope = z.infer<typeof scopeSchema>;

type Actor = { id: string; email: string };

/** Checks the right permission for the scope and returns the actor. */
async function authorise(
  scope: Scope,
  action: "page" | "placement",
): Promise<Actor> {
  if (scope.scope === "platform") {
    await requirePlatformPermission(
      action === "page" ? "platform.page.manage" : "platform.placement.manage",
    );
  } else {
    await requireStorePermission(
      scope.storeId,
      action === "page" ? "page.create" : "placement.manage",
    );
  }

  const session = await getSession();
  if (!session) throw new Error("Not signed in");
  return { id: session.user.id, email: session.user.email };
}

const pageInput = z.object({
  title: z.string().trim().min(1).max(200),
  slug: z.string().trim().max(200).optional(),
  excerpt: z.string().trim().max(400).optional(),
  seoTitle: z.string().trim().max(200).optional(),
  seoDescription: z.string().trim().max(400).optional(),
});

export type ContentResult =
  | { ok: true; id: string; message: string }
  | { ok: false; message: string };

export async function createPageAction(
  input: Scope & z.input<typeof pageInput>,
): Promise<ContentResult> {
  const scope = scopeSchema.safeParse(input);
  if (!scope.success) return { ok: false, message: "Invalid scope." };

  const parsed = pageInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }

  const actor = await authorise(scope.data, "page");
  const slug = slugify(parsed.data.slug || parsed.data.title);
  if (!slug) {
    return { ok: false, message: "That title needs a letter or number." };
  }

  try {
    const [created] = await db
      .insert(pages)
      .values({
        scope: scope.data.scope,
        storeId: scope.data.scope === "store" ? scope.data.storeId : null,
        slug,
        title: parsed.data.title,
        excerpt: parsed.data.excerpt || null,
        seoTitle: parsed.data.seoTitle || null,
        seoDescription: parsed.data.seoDescription || null,
        status: "draft",
        createdBy: actor.id,
        updatedBy: actor.id,
      })
      .returning({ id: pages.id });

    revalidatePath("/admin/content");
    return {
      ok: true,
      id: created.id,
      message: `Created "${parsed.data.title}".`,
    };
  } catch (error) {
    // The partial unique index on slug is the real guard; report it kindly.
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        message: `A page with the slug "${slug}" already exists.`,
      };
    }
    throw error;
  }
}

const updatePageSchema = pageInput.extend({ pageId: z.uuid() });

/**
 * Edits a page's own fields.
 *
 * The slug is editable, which means it is also breakable: anything already
 * linking to the old address stops working. So it only changes when the seller
 * types a new one, never as a side effect of renaming the title. A page called
 * "Shipping" that quietly moves to /returns because somebody fixed a typo in
 * the heading is a worse outcome than a slug that no longer matches.
 */
export async function updatePageAction(
  input: Scope & z.input<typeof updatePageSchema>,
): Promise<ContentResult> {
  const scope = scopeSchema.safeParse(input);
  if (!scope.success) return { ok: false, message: "Invalid scope." };

  const parsed = updatePageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }

  if (scope.data.scope === "store") {
    await requireStorePermission(scope.data.storeId, "page.update");
  } else {
    await requirePlatformPermission("platform.page.manage");
  }
  const session = await getSession();
  if (!session) return { ok: false, message: "Not signed in." };

  const page = await pageInScope(parsed.data.pageId, scope.data);
  if (!page) return { ok: false, message: "Page not found." };

  const slug = parsed.data.slug ? slugify(parsed.data.slug) : page.slug;
  if (!slug)
    return { ok: false, message: "That slug needs a letter or number." };

  try {
    await db
      .update(pages)
      .set({
        title: parsed.data.title,
        slug,
        excerpt: parsed.data.excerpt || null,
        seoTitle: parsed.data.seoTitle || null,
        seoDescription: parsed.data.seoDescription || null,
        updatedBy: session.user.id,
      })
      .where(eq(pages.id, parsed.data.pageId));
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        message: `A page with the slug "${slug}" already exists.`,
      };
    }
    throw error;
  }

  // Both, because the old address needs to stop resolving as well.
  revalidatePath(`/pages/${page.slug}`);
  revalidatePath(`/pages/${slug}`);
  revalidatePath("/admin/content");
  return { ok: true, id: parsed.data.pageId, message: "Saved." };
}

/**
 * Deletes a page and its blocks.
 *
 * Refuses while it is published. Taking a live page down is a separate,
 * reversible decision, and making it a required first step means nobody
 * removes something buyers are currently reading in one click.
 */
export async function deletePageAction(
  input: Scope & { pageId: string },
): Promise<ContentResult> {
  const scope = scopeSchema.safeParse(input);
  if (!scope.success) return { ok: false, message: "Invalid scope." };
  const pageId = z.uuid().safeParse(input.pageId);
  if (!pageId.success) return { ok: false, message: "Invalid request." };

  if (scope.data.scope === "store") {
    await requireStorePermission(scope.data.storeId, "page.delete");
  } else {
    await requirePlatformPermission("platform.page.manage");
  }
  const session = await getSession();
  if (!session) return { ok: false, message: "Not signed in." };

  const page = await pageInScope(pageId.data, scope.data);
  if (!page) return { ok: false, message: "Page not found." };

  if (page.status === "published") {
    return {
      ok: false,
      message: "Unpublish it first. Buyers may be reading it right now.",
    };
  }

  await db.transaction(async (tx) => {
    await tx.insert(auditLog).values({
      storeId: scope.data.scope === "store" ? scope.data.storeId : null,
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: "page.delete",
      targetType: "page",
      targetId: pageId.data,
      targetLabel: page.title,
      before: { slug: page.slug, status: page.status },
    });

    // Blocks cascade from the page.
    await tx.delete(pages).where(eq(pages.id, pageId.data));
  });

  revalidatePath(`/pages/${page.slug}`);
  revalidatePath("/admin/content");
  return { ok: true, id: pageId.data, message: `Deleted "${page.title}".` };
}

const publishSchema = z.object({ pageId: z.uuid(), publish: z.boolean() });

export async function setPagePublishedAction(
  input: Scope & z.input<typeof publishSchema>,
): Promise<ContentResult> {
  const scope = scopeSchema.parse(input);
  const { pageId, publish } = publishSchema.parse(input);

  // Publishing is a separate permission from editing, so a role can draft
  // without being able to put it in front of buyers.
  if (scope.scope === "store") {
    await requireStorePermission(scope.storeId, "page.publish");
  } else {
    await requirePlatformPermission("platform.page.manage");
  }
  const session = await getSession();
  if (!session) return { ok: false, message: "Not signed in." };

  const page = await pageInScope(pageId, scope);
  if (!page) return { ok: false, message: "Page not found." };

  await db
    .update(pages)
    .set({
      status: publish ? "published" : "draft",
      publishedAt: publish ? new Date() : null,
      updatedBy: session.user.id,
    })
    .where(eq(pages.id, pageId));

  await db.insert(auditLog).values({
    storeId: scope.scope === "store" ? scope.storeId : null,
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: publish ? "page.publish" : "page.unpublish",
    targetType: "page",
    targetId: pageId,
    targetLabel: page.title,
    before: { status: page.status },
    after: { status: publish ? "published" : "draft" },
  });

  revalidatePath(`/pages/${page.slug}`);
  revalidatePath("/admin/content");
  return {
    ok: true,
    id: pageId,
    message: publish ? "Published." : "Moved back to draft.",
  };
}

const blockSchema = z.object({
  pageId: z.uuid(),
  type: z.string().max(40),
  data: z.record(z.string(), z.unknown()),
});

export async function addBlockAction(
  input: Scope & z.input<typeof blockSchema>,
): Promise<ContentResult> {
  const scope = scopeSchema.parse(input);
  const parsed = blockSchema.parse(input);
  await authorise(scope, "page");

  const page = await pageInScope(parsed.pageId, scope);
  if (!page) return { ok: false, message: "Page not found." };

  // The block payload is validated against its own schema, which is also what
  // rejects a javascript: URL in a CTA before it can be stored.
  const validated = validateBlockInput(parsed.type, parsed.data);
  if (!validated.ok) return { ok: false, message: validated.message };

  const [{ highest }] = await db
    .select({ highest: max(pageBlocks.position) })
    .from(pageBlocks)
    .where(eq(pageBlocks.pageId, parsed.pageId));

  const [created] = await db
    .insert(pageBlocks)
    .values({
      pageId: parsed.pageId,
      type: parsed.type,
      data: validated.data,
      position: (highest ?? -1) + 1,
    })
    .returning({ id: pageBlocks.id });

  revalidatePath(`/pages/${page.slug}`);
  return { ok: true, id: created.id, message: "Block added." };
}

export async function deleteBlockAction(
  input: Scope & { blockId: string },
): Promise<ContentResult> {
  const scope = scopeSchema.parse(input);
  const blockId = z.uuid().parse(input.blockId);
  await authorise(scope, "page");

  // Scoped through the page, so a block id from another store's page is not
  // deletable just because it is a valid uuid.
  const [block] = await db
    .select({ id: pageBlocks.id, pageId: pageBlocks.pageId })
    .from(pageBlocks)
    .innerJoin(pages, eq(pages.id, pageBlocks.pageId))
    .where(
      and(
        eq(pageBlocks.id, blockId),
        scope.scope === "store"
          ? eq(pages.storeId, scope.storeId)
          : isNull(pages.storeId),
      ),
    )
    .limit(1);

  if (!block) return { ok: false, message: "Block not found." };

  await db.delete(pageBlocks).where(eq(pageBlocks.id, blockId));
  revalidatePath("/admin/content");
  return { ok: true, id: blockId, message: "Block removed." };
}

// ---------------------------------------------------------------------------
// Placements
// ---------------------------------------------------------------------------

const targetSchema = z.object({
  targetType: z.enum([
    "everywhere",
    "home",
    "search",
    "cart",
    "category",
    "product",
    "store",
    "page",
  ]),
  targetValue: z.string().trim().max(200).nullable().default(null),
  isExclusion: z.boolean().default(false),
});

const placementSchema = z.object({
  type: z.string().max(40),
  slot: z.enum([
    "announcement_bar",
    "above_content",
    "below_content",
    "product_top",
    "product_before_price",
    "product_after_options",
    "product_sidebar",
    "product_below_details",
    "in_grid",
  ]),
  data: z.record(z.string(), z.unknown()),
  priority: z.number().int().min(0).max(1000).default(0),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  targets: z.array(targetSchema).min(1).max(50),
  publish: z.boolean().default(false),
});

/**
 * Sellers may only use the slots that sit inside their own listing.
 *
 * The announcement bar and the page-level bands are site furniture — above the
 * header, or wrapping the whole page — so a seller placing something there
 * would be dressing a page they do not own. Checked here rather than only in
 * the form, because the form is a courtesy and this is the control.
 */
function slotAllowedForScope(
  scope: { scope: "platform" | "store" },
  slot: string,
): boolean {
  if (scope.scope === "platform") return true;
  return (STORE_ASSIGNABLE_SLOTS as readonly string[]).includes(slot);
}

export async function createPlacementAction(
  input: Scope & z.input<typeof placementSchema>,
): Promise<ContentResult> {
  const scope = scopeSchema.safeParse(input);
  if (!scope.success) return { ok: false, message: "Invalid scope." };

  const parsed = placementSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }

  const actor = await authorise(scope.data, "placement");

  if (!slotAllowedForScope(scope.data, parsed.data.slot)) {
    return {
      ok: false,
      message:
        "That position belongs to the whole site. A store offer can sit anywhere on its own product pages.",
    };
  }

  const validated = validateBlockInput(parsed.data.type, parsed.data.data);
  if (!validated.ok) return { ok: false, message: validated.message };

  const starts = parsed.data.startsAt ? new Date(parsed.data.startsAt) : null;
  const ends = parsed.data.endsAt ? new Date(parsed.data.endsAt) : null;
  if (starts && ends && ends <= starts) {
    return { ok: false, message: "The end must come after the start." };
  }

  const id = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(placements)
      .values({
        scope: scope.data.scope,
        storeId: scope.data.scope === "store" ? scope.data.storeId : null,
        type: parsed.data.type,
        slot: parsed.data.slot,
        data: validated.data,
        priority: parsed.data.priority,
        status: parsed.data.publish ? "published" : "draft",
        startsAt: starts,
        endsAt: ends,
        createdBy: actor.id,
      })
      .returning({ id: placements.id });

    await tx.insert(placementTargets).values(
      parsed.data.targets.map((target) => ({
        placementId: created.id,
        targetType: target.targetType,
        targetValue: target.targetValue,
        isExclusion: target.isExclusion,
      })),
    );

    await tx.insert(auditLog).values({
      storeId: scope.data.scope === "store" ? scope.data.storeId : null,
      actorId: actor.id,
      actorEmail: actor.email,
      action: "placement.create",
      targetType: "placement",
      targetId: created.id,
      after: {
        type: parsed.data.type,
        slot: parsed.data.slot,
        targets: parsed.data.targets,
        published: parsed.data.publish,
      },
    });

    return created.id;
  });

  // A placement can appear anywhere, so nothing narrower than the whole
  // storefront is safe to revalidate.
  revalidatePath("/", "layout");
  return { ok: true, id, message: "Placement created." };
}

export async function setPlacementStatusAction(
  input: Scope & { placementId: string; publish: boolean },
): Promise<ContentResult> {
  const scope = scopeSchema.parse(input);
  const placementId = z.uuid().parse(input.placementId);
  const publish = z.boolean().parse(input.publish);
  const actor = await authorise(scope, "placement");

  const [existing] = await db
    .select({ id: placements.id, status: placements.status })
    .from(placements)
    .where(
      and(
        eq(placements.id, placementId),
        scope.scope === "store"
          ? eq(placements.storeId, scope.storeId)
          : isNull(placements.storeId),
      ),
    )
    .limit(1);

  if (!existing) return { ok: false, message: "Placement not found." };

  await db
    .update(placements)
    .set({ status: publish ? "published" : "draft" })
    .where(eq(placements.id, placementId));

  await db.insert(auditLog).values({
    storeId: scope.scope === "store" ? scope.storeId : null,
    actorId: actor.id,
    actorEmail: actor.email,
    action: publish ? "placement.publish" : "placement.unpublish",
    targetType: "placement",
    targetId: placementId,
    before: { status: existing.status },
    after: { status: publish ? "published" : "draft" },
  });

  revalidatePath("/", "layout");
  return { ok: true, id: placementId, message: publish ? "Live." : "Paused." };
}

export async function deletePlacementAction(
  input: Scope & { placementId: string },
): Promise<ContentResult> {
  const scope = scopeSchema.parse(input);
  const placementId = z.uuid().parse(input.placementId);
  await authorise(scope, "placement");

  const result = await db
    .delete(placements)
    .where(
      and(
        eq(placements.id, placementId),
        scope.scope === "store"
          ? eq(placements.storeId, scope.storeId)
          : isNull(placements.storeId),
      ),
    )
    .returning({ id: placements.id });

  if (result.length === 0)
    return { ok: false, message: "Placement not found." };

  revalidatePath("/", "layout");
  return { ok: true, id: placementId, message: "Deleted." };
}

async function pageInScope(pageId: string, scope: Scope) {
  const [page] = await db
    .select({
      id: pages.id,
      slug: pages.slug,
      title: pages.title,
      status: pages.status,
    })
    .from(pages)
    .where(
      and(
        eq(pages.id, pageId),
        scope.scope === "store"
          ? eq(pages.storeId, scope.storeId)
          : isNull(pages.storeId),
      ),
    )
    .limit(1);
  return page ?? null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "23505"
  );
}
