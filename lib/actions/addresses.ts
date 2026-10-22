"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { addresses } from "@/lib/db/schema";

/**
 * Saved addresses.
 *
 * These are a convenience for filling in checkout, never a source of truth for
 * an order. An order snapshots the address into `orders.shipping_address` at
 * purchase time, so editing or deleting a saved address here cannot change
 * where a past order says it went.
 */

export type AddressResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

const addressSchema = z.object({
  id: z.uuid().optional(),
  label: z.string().trim().max(40).optional(),
  recipientName: z.string().trim().min(1, "Enter a name").max(120),
  phone: z.string().trim().max(40).optional(),
  line1: z.string().trim().min(1, "Enter an address").max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1, "Enter a city").max(120),
  region: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().min(1, "Enter a postcode").max(40),
  countryCode: z.string().trim().length(2, "Use a 2-letter country code"),
  isDefaultShipping: z.boolean().default(false),
});

const MAX_ADDRESSES = 20;

export async function saveAddressAction(
  input: z.input<typeof addressSchema>,
): Promise<AddressResult> {
  const parsed = addressSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const data = parsed.data;
  const user = await requireUser();

  if (!data.id) {
    const existing = await db
      .select({ id: addresses.id })
      .from(addresses)
      .where(eq(addresses.userId, user.id));
    if (existing.length >= MAX_ADDRESSES) {
      return {
        ok: false,
        message: `You can save ${MAX_ADDRESSES} addresses. Remove one first.`,
      };
    }
  }

  const values = {
    label: data.label || null,
    recipientName: data.recipientName,
    phone: data.phone || null,
    line1: data.line1,
    line2: data.line2 || null,
    city: data.city,
    region: data.region || null,
    postalCode: data.postalCode,
    countryCode: data.countryCode.toUpperCase(),
    isDefaultShipping: data.isDefaultShipping,
  };

  await db.transaction(async (tx) => {
    // Only one default. Cleared first so the new one cannot briefly be the
    // second default and be picked at checkout in between.
    if (data.isDefaultShipping) {
      await tx
        .update(addresses)
        .set({ isDefaultShipping: false })
        .where(eq(addresses.userId, user.id));
    }

    if (data.id) {
      // Scoped to the owner, so an id from somebody else updates nothing.
      await tx
        .update(addresses)
        .set(values)
        .where(and(eq(addresses.id, data.id), eq(addresses.userId, user.id)));
    } else {
      await tx.insert(addresses).values({ userId: user.id, ...values });
    }
  });

  revalidatePath("/account/addresses");
  revalidatePath("/checkout");
  return { ok: true, message: data.id ? "Address updated." : "Address saved." };
}

export async function deleteAddressAction(input: {
  addressId: string;
}): Promise<AddressResult> {
  const addressId = z.uuid().parse(input.addressId);
  const user = await requireUser();

  const deleted = await db
    .delete(addresses)
    .where(and(eq(addresses.id, addressId), eq(addresses.userId, user.id)))
    .returning({ id: addresses.id });

  if (deleted.length === 0) {
    return { ok: false, message: "Address not found." };
  }

  revalidatePath("/account/addresses");
  revalidatePath("/checkout");
  return { ok: true, message: "Removed." };
}

export async function setDefaultAddressAction(input: {
  addressId: string;
}): Promise<AddressResult> {
  const addressId = z.uuid().parse(input.addressId);
  const user = await requireUser();

  const [owned] = await db
    .select({ id: addresses.id })
    .from(addresses)
    .where(and(eq(addresses.id, addressId), eq(addresses.userId, user.id)))
    .limit(1);
  if (!owned) return { ok: false, message: "Address not found." };

  await db.transaction(async (tx) => {
    await tx
      .update(addresses)
      .set({ isDefaultShipping: false })
      .where(eq(addresses.userId, user.id));
    await tx
      .update(addresses)
      .set({ isDefaultShipping: true })
      .where(eq(addresses.id, addressId));
  });

  revalidatePath("/account/addresses");
  revalidatePath("/checkout");
  return { ok: true, message: "Default updated." };
}

/** This user's addresses, default first. */
export async function listAddressesAction() {
  const user = await requireUser();
  return db
    .select()
    .from(addresses)
    .where(eq(addresses.userId, user.id))
    .orderBy(desc(addresses.isDefaultShipping), desc(addresses.updatedAt));
}
