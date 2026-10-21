"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { savedItems } from "@/lib/db/schema";

export type ToggleSavedResult =
  | { ok: true; saved: boolean }
  | { ok: false; reason: "signed-out" | "invalid" };

export async function toggleSavedAction(input: {
  productId: string;
}): Promise<ToggleSavedResult> {
  const parsed = z.uuid().safeParse(input.productId);
  if (!parsed.success) return { ok: false, reason: "invalid" };

  const session = await getSession();
  // Guests get prompted to sign in rather than silently losing the save.
  if (!session) return { ok: false, reason: "signed-out" };

  const existing = await db
    .select({ id: savedItems.id })
    .from(savedItems)
    .where(
      and(
        eq(savedItems.userId, session.user.id),
        eq(savedItems.productId, parsed.data),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await db.delete(savedItems).where(eq(savedItems.id, existing[0].id));
    revalidatePath("/account/saved");
    return { ok: true, saved: false };
  }

  await db
    .insert(savedItems)
    .values({ userId: session.user.id, productId: parsed.data })
    // Double-click, or two tabs. The unique index is the backstop.
    .onConflictDoNothing();

  revalidatePath("/account/saved");
  return { ok: true, saved: true };
}
