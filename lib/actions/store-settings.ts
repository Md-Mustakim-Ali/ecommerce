"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStorePermission } from "@/lib/auth/access";
import { getSession } from "@/lib/auth/guards";
import { slugify } from "@/lib/catalog/normalize";
import { db } from "@/lib/db";
import { auditLog, stores } from "@/lib/db/schema";
import {
  isAcceptedImageType,
  MAX_IMAGE_BYTES,
  storageProvider,
} from "@/lib/storage";
import { ACCENT_VALUES } from "@/lib/stores/appearance";

/**
 * Store profile and appearance.
 *
 * Two permissions, deliberately separate. `store.profile.update` covers what
 * the store says about itself; `store.theme.update` covers how it looks. A
 * support person who can correct a phone number has no reason to be able to
 * change the brand colour.
 *
 * Theming stays constrained — an accent colour and a layout preset, nothing
 * more. Product page, cart and checkout are identical across every store,
 * because a shopper who has to relearn the buy button on each seller's page
 * buys from fewer of them.
 */

export type SettingsResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

const profileSchema = z.object({
  storeId: z.uuid(),
  name: z.string().trim().min(2, "Give the store a name").max(80),
  slug: z
    .string()
    .trim()
    .min(2, "The address needs at least two characters")
    .max(60),
  description: z.string().trim().max(600).optional(),
  supportEmail: z.email("Enter a valid email").optional().or(z.literal("")),
  supportPhone: z.string().trim().max(40).optional(),
});

export async function updateStoreProfileAction(
  input: z.input<typeof profileSchema>,
): Promise<SettingsResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  const access = await requireStorePermission(
    data.storeId,
    "store.profile.update",
  );
  const session = await getSession();
  if (!session) return { ok: false, message: "Not signed in." };

  const [existing] = await db
    .select({ slug: stores.slug, name: stores.name })
    .from(stores)
    .where(eq(stores.id, data.storeId))
    .limit(1);
  if (!existing) return { ok: false, message: "Store not found." };

  const slug = slugify(data.slug);
  if (!slug) {
    return { ok: false, message: "That address needs a letter or a number." };
  }

  // Changing the slug breaks every link anyone has to this store, so it is
  // owner-only rather than something a staff member can do in passing.
  if (slug !== existing.slug && !access.isOwner) {
    return {
      ok: false,
      message: "Only the owner can change the store address.",
    };
  }

  const [clash] = await db
    .select({ id: stores.id })
    .from(stores)
    .where(and(eq(stores.slug, slug), ne(stores.id, data.storeId)))
    .limit(1);
  if (clash) {
    return { ok: false, message: `/${slug} is taken. Pick another address.` };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(stores)
      .set({
        name: data.name,
        slug,
        description: data.description || null,
        supportEmail: data.supportEmail || null,
        supportPhone: data.supportPhone || null,
      })
      .where(eq(stores.id, data.storeId));

    // A renamed store is worth recording. When a buyer disputes an order
    // against a store that no longer answers to that name, this is the trail.
    if (slug !== existing.slug || data.name !== existing.name) {
      await tx.insert(auditLog).values({
        storeId: data.storeId,
        actorId: session.user.id,
        actorEmail: session.user.email,
        action: "store.profile.update",
        targetType: "store",
        targetId: data.storeId,
        targetLabel: data.name,
        before: { name: existing.name, slug: existing.slug },
        after: { name: data.name, slug },
      });
    }
  });

  revalidatePath(`/dashboard/${data.storeId}/settings`);
  revalidatePath(`/store/${slug}`);
  if (slug !== existing.slug) revalidatePath(`/store/${existing.slug}`);

  return { ok: true, message: "Saved." };
}

const appearanceSchema = z.object({
  storeId: z.uuid(),
  accentColor: z.enum(ACCENT_VALUES).nullable(),
  layoutPreset: z.enum(["classic", "editorial", "gallery"]),
});

export async function updateStoreAppearanceAction(
  input: z.input<typeof appearanceSchema>,
): Promise<SettingsResult> {
  const parsed = appearanceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  await requireStorePermission(data.storeId, "store.theme.update");

  await db
    .update(stores)
    .set({
      accentColor: data.accentColor,
      layoutPreset: data.layoutPreset,
    })
    .where(eq(stores.id, data.storeId));

  revalidatePath(`/dashboard/${data.storeId}/settings`);
  revalidatePath("/store", "layout");
  return { ok: true, message: "Saved." };
}

/**
 * Logo or banner upload.
 *
 * Goes through the same storage adapter as product images, so it is re-encoded,
 * stripped of EXIF and size-capped identically. The aspect ratio is whatever
 * the seller uploaded; the store page crops with object-cover and puts a scrim
 * behind the name, which is what keeps a 4000x600 banner and a square one both
 * legible.
 */
export async function uploadStoreImageAction(
  formData: FormData,
): Promise<SettingsResult> {
  const storeId = z.uuid().safeParse(formData.get("storeId"));
  const kind = z.enum(["logo", "banner"]).safeParse(formData.get("kind"));
  if (!storeId.success || !kind.success) {
    return { ok: false, message: "Invalid request." };
  }

  await requireStorePermission(storeId.data, "store.theme.update");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose a file." };
  }
  if (!isAcceptedImageType(file.type)) {
    return { ok: false, message: "Images only — JPEG, PNG, WebP or AVIF." };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      message: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`,
    };
  }

  const [store] = await db
    .select({
      slug: stores.slug,
      logoUrl: stores.logoUrl,
      bannerUrl: stores.bannerUrl,
    })
    .from(stores)
    .where(eq(stores.id, storeId.data))
    .limit(1);
  if (!store) return { ok: false, message: "Store not found." };

  let stored: Awaited<ReturnType<ReturnType<typeof storageProvider>["upload"]>>;
  try {
    stored = await storageProvider().upload({
      scope: `stores/${storeId.data}`,
      filename: `${kind.data}-${file.name}`,
      contentType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }

  const previous = kind.data === "logo" ? store.logoUrl : store.bannerUrl;

  await db
    .update(stores)
    .set(
      kind.data === "logo"
        ? { logoUrl: stored.url }
        : { bannerUrl: stored.url },
    )
    .where(eq(stores.id, storeId.data));

  // The old file is only ours to delete if we uploaded it. Seeded stores point
  // at a remote host.
  if (previous?.startsWith("/uploads/")) {
    try {
      await storageProvider().remove(previous.replace(/^\/uploads\//, ""));
    } catch {
      // An orphaned file is untidy; a failed save because cleanup failed is worse.
    }
  }

  revalidatePath(`/dashboard/${storeId.data}/settings`);
  revalidatePath(`/store/${store.slug}`);
  return {
    ok: true,
    message: `${kind.data === "logo" ? "Logo" : "Banner"} updated.`,
  };
}

export async function removeStoreImageAction(input: {
  storeId: string;
  kind: "logo" | "banner";
}): Promise<SettingsResult> {
  const storeId = z.uuid().parse(input.storeId);
  const kind = z.enum(["logo", "banner"]).parse(input.kind);

  await requireStorePermission(storeId, "store.theme.update");

  const [store] = await db
    .select({
      slug: stores.slug,
      logoUrl: stores.logoUrl,
      bannerUrl: stores.bannerUrl,
    })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);
  if (!store) return { ok: false, message: "Store not found." };

  const current = kind === "logo" ? store.logoUrl : store.bannerUrl;

  await db
    .update(stores)
    .set(kind === "logo" ? { logoUrl: null } : { bannerUrl: null })
    .where(eq(stores.id, storeId));

  if (current?.startsWith("/uploads/")) {
    try {
      await storageProvider().remove(current.replace(/^\/uploads\//, ""));
    } catch {
      // See above.
    }
  }

  revalidatePath(`/dashboard/${storeId}/settings`);
  revalidatePath(`/store/${store.slug}`);
  return { ok: true, message: "Removed." };
}
