"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePlatformPermission } from "@/lib/auth/access";
import { getSession } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { auditLog, platformSettings } from "@/lib/db/schema";

/**
 * Platform settings.
 *
 * The commission rate is the sensitive one. Changing it must never restate
 * what a past order earned — `sub_orders.commission_cents` is written at
 * purchase time from the rate then in force and read from there forever, so
 * this only affects orders placed after the change. The audit entry records
 * the before and after, which is what makes a payout dispute answerable.
 */

export type SettingsResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

const schema = z.object({
  /** Percent, as typed. Converted to basis points so 8.5% is exact. */
  commissionPercent: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Enter a percentage like 10 or 8.5"),
  freeShippingThreshold: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 75.00"),
  flatShipping: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 5.99"),
  maintenanceNotice: z.string().trim().max(300).optional(),
});

function toCents(value: string): number {
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
}

export async function updatePlatformSettingsAction(
  input: z.input<typeof schema>,
): Promise<SettingsResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  await requirePlatformPermission("platform.settings.manage");
  const session = await getSession();
  if (!session) return { ok: false, message: "Not signed in." };

  const percent = Number(data.commissionPercent);
  if (percent < 0 || percent > 100) {
    return { ok: false, message: "Commission has to be between 0 and 100%." };
  }
  const commissionBps = Math.round(percent * 100);

  const [before] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.id, "default"))
    .limit(1);

  const values = {
    commissionBps,
    freeShippingThresholdCents: toCents(data.freeShippingThreshold),
    flatShippingCents: toCents(data.flatShipping),
    maintenanceNotice: data.maintenanceNotice || null,
    updatedBy: session.user.id,
    updatedAt: new Date(),
  };

  await db.transaction(async (tx) => {
    // Upsert, because a fresh database that skipped the seed would not have
    // the row even though the migration creates the table.
    await tx
      .insert(platformSettings)
      .values({ id: "default", ...values })
      .onConflictDoUpdate({ target: platformSettings.id, set: values });

    await tx.insert(auditLog).values({
      storeId: null,
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: "platform.settings.update",
      targetType: "settings",
      targetId: "default",
      before: before
        ? {
            commissionBps: before.commissionBps,
            freeShippingThresholdCents: before.freeShippingThresholdCents,
            flatShippingCents: before.flatShippingCents,
          }
        : null,
      after: {
        commissionBps: values.commissionBps,
        freeShippingThresholdCents: values.freeShippingThresholdCents,
        flatShippingCents: values.flatShippingCents,
      },
    });
  });

  revalidatePath("/admin/settings");
  revalidatePath("/checkout");

  const moved =
    before && before.commissionBps !== commissionBps
      ? ` Commission moves from ${(before.commissionBps / 100).toFixed(2)}% to ${percent}% on new orders only.`
      : "";

  return { ok: true, message: `Saved.${moved}` };
}
