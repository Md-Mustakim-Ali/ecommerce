"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getStoreAccess } from "@/lib/auth/access";
import { getSession } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import {
  auditLog,
  products,
  storeMemberRoles,
  storeMembers,
  stores,
  subOrders,
  user,
} from "@/lib/db/schema";
import { storeBalance } from "@/lib/money/ledger";

/**
 * The four actions reserved to the store owner.
 *
 * These are deliberately not permission keys. Anything expressible in the
 * vocabulary can be put in a custom role, and these must never be — an owner
 * who could delegate "change payout destination" could be socially engineered
 * into handing over their revenue. `stores.owner_id` is the only thing that
 * authorises them, and it cannot be granted, copied or assumed.
 *
 * See OWNER_ONLY_ACTIONS in lib/auth/permissions.ts.
 */

export type OwnerResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/**
 * Confirms the caller is the owner of this specific store.
 *
 * Not requireStorePermission: the owner holds every permission, so a
 * permission check would also pass for a manager with a fully-loaded custom
 * role. Only identity works here.
 */
async function requireOwner(storeId: string) {
  const access = await getStoreAccess(storeId);
  const session = await getSession();
  if (!access || !session) return null;
  if (!access.isOwner) return null;
  return { userId: session.user.id, email: session.user.email };
}

// ---------------------------------------------------------------------------
// Payout destination and billing
// ---------------------------------------------------------------------------

const payoutSchema = z.object({
  storeId: z.uuid(),
  /** An opaque provider reference. Never bank details. */
  accountRef: z.string().trim().max(120),
  label: z.string().trim().max(80).optional(),
});

export async function updatePayoutDestinationAction(
  input: z.input<typeof payoutSchema>,
): Promise<OwnerResult> {
  const parsed = payoutSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  const owner = await requireOwner(data.storeId);
  if (!owner) {
    return { ok: false, message: "Only the store owner can change this." };
  }

  // Catches the obvious mistake: a bare string of digits is almost certainly
  // an account or card number pasted into the wrong field. It is a guard rail,
  // not a guarantee — a formatted sort code gets through — so the field label
  // does the rest of the work.
  const digits = data.accountRef.replace(/\D/g, "");
  if (digits.length >= 8 && digits.length === data.accountRef.trim().length) {
    return {
      ok: false,
      message:
        "That looks like an account number. Paste the reference from your payment provider, not bank details — this field is not built to hold them.",
    };
  }

  const [before] = await db
    .select({
      ref: stores.payoutAccountRef,
      label: stores.payoutAccountLabel,
      name: stores.name,
    })
    .from(stores)
    .where(eq(stores.id, data.storeId))
    .limit(1);
  if (!before) return { ok: false, message: "Store not found." };

  await db.transaction(async (tx) => {
    await tx
      .update(stores)
      .set({
        payoutAccountRef: data.accountRef || null,
        payoutAccountLabel: data.label || null,
      })
      .where(eq(stores.id, data.storeId));

    // The single most abused change in any marketplace. Recorded with who,
    // when, and the before value, so a fraudulent switch is traceable.
    await tx.insert(auditLog).values({
      storeId: data.storeId,
      actorId: owner.userId,
      actorEmail: owner.email,
      action: "store.payout_destination.update",
      targetType: "store",
      targetId: data.storeId,
      targetLabel: before.name,
      before: { accountRef: before.ref, label: before.label },
      after: { accountRef: data.accountRef, label: data.label ?? null },
    });
  });

  revalidatePath(`/dashboard/${data.storeId}/settings`);
  return { ok: true, message: "Payout destination updated." };
}

const billingSchema = z.object({
  storeId: z.uuid(),
  billingName: z.string().trim().max(120).optional(),
  billingTaxId: z.string().trim().max(60).optional(),
  billingAddress: z.string().trim().max(400).optional(),
});

export async function updateBillingAction(
  input: z.input<typeof billingSchema>,
): Promise<OwnerResult> {
  const parsed = billingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  const owner = await requireOwner(data.storeId);
  if (!owner) {
    return { ok: false, message: "Only the store owner can change this." };
  }

  const [before] = await db
    .select({
      name: stores.billingName,
      taxId: stores.billingTaxId,
      address: stores.billingAddress,
      storeName: stores.name,
    })
    .from(stores)
    .where(eq(stores.id, data.storeId))
    .limit(1);
  if (!before) return { ok: false, message: "Store not found." };

  await db.transaction(async (tx) => {
    await tx
      .update(stores)
      .set({
        billingName: data.billingName || null,
        billingTaxId: data.billingTaxId || null,
        billingAddress: data.billingAddress || null,
      })
      .where(eq(stores.id, data.storeId));

    // Audited like the other three owner-only actions. This is the legal
    // entity that appears on invoices, so a change to it is a change to who
    // the marketplace believes it is trading with.
    await tx.insert(auditLog).values({
      storeId: data.storeId,
      actorId: owner.userId,
      actorEmail: owner.email,
      action: "store.billing.update",
      targetType: "store",
      targetId: data.storeId,
      targetLabel: before.storeName,
      before: {
        name: before.name,
        taxId: before.taxId,
        address: before.address,
      },
      after: {
        name: data.billingName ?? null,
        taxId: data.billingTaxId ?? null,
        address: data.billingAddress ?? null,
      },
    });
  });

  revalidatePath(`/dashboard/${data.storeId}/settings`);
  return { ok: true, message: "Billing details updated." };
}

// ---------------------------------------------------------------------------
// Transfer
// ---------------------------------------------------------------------------

const transferSchema = z.object({
  storeId: z.uuid(),
  email: z.email("Enter a valid email"),
  /** The store name, typed back. */
  confirmation: z.string().trim(),
});

/**
 * Hands the store to somebody else.
 *
 * Irreversible from the current owner's side: once done they hold nothing
 * unless the new owner grants it back. So it asks for the store's name to be
 * typed out, which is the cheapest way to make sure the click was deliberate.
 *
 * The outgoing owner is left as an active member with no roles rather than
 * removed. Being silently ejected from a store you built, with no record of
 * having been there, is a worse outcome than holding nothing.
 */
export async function transferOwnershipAction(
  input: z.input<typeof transferSchema>,
): Promise<OwnerResult> {
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  const owner = await requireOwner(data.storeId);
  if (!owner) {
    return { ok: false, message: "Only the store owner can transfer a store." };
  }

  const [store] = await db
    .select({ id: stores.id, name: stores.name, ownerId: stores.ownerId })
    .from(stores)
    .where(eq(stores.id, data.storeId))
    .limit(1);
  if (!store) return { ok: false, message: "Store not found." };

  if (data.confirmation !== store.name) {
    return {
      ok: false,
      message: `Type the store name exactly — "${store.name}" — to confirm.`,
    };
  }

  const [recipient] = await db
    .select({ id: user.id, email: user.email, name: user.name })
    .from(user)
    .where(eq(user.email, data.email.toLowerCase()))
    .limit(1);

  if (!recipient) {
    return {
      ok: false,
      message: `No account for ${data.email}. They need to sign up first.`,
    };
  }
  if (recipient.id === store.ownerId) {
    return { ok: false, message: "They already own this store." };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(stores)
      .set({ ownerId: recipient.id })
      .where(eq(stores.id, data.storeId));

    // The new owner does not need a membership row — ownership is checked
    // against stores.owner_id — so remove one if they had it, to avoid a stale
    // row that suggests their access comes from a role.
    await tx
      .delete(storeMembers)
      .where(
        and(
          eq(storeMembers.storeId, data.storeId),
          eq(storeMembers.userId, recipient.id),
        ),
      );

    // The outgoing owner becomes a member with no roles: still listed, holding
    // nothing, and visible to the new owner to restore if that was the intent.
    const [existing] = await tx
      .select({ id: storeMembers.id })
      .from(storeMembers)
      .where(
        and(
          eq(storeMembers.storeId, data.storeId),
          eq(storeMembers.userId, owner.userId),
        ),
      )
      .limit(1);

    if (!existing) {
      await tx.insert(storeMembers).values({
        storeId: data.storeId,
        userId: owner.userId,
        status: "active",
        joinedAt: new Date(),
        invitedBy: recipient.id,
      });
    } else {
      await tx
        .delete(storeMemberRoles)
        .where(eq(storeMemberRoles.memberId, existing.id));
    }

    await tx.insert(auditLog).values({
      storeId: data.storeId,
      actorId: owner.userId,
      actorEmail: owner.email,
      action: "store.transfer_ownership",
      targetType: "store",
      targetId: data.storeId,
      targetLabel: store.name,
      before: { ownerEmail: owner.email },
      after: { ownerEmail: recipient.email },
    });
  });

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/${data.storeId}`);
  return {
    ok: true,
    message: `${store.name} now belongs to ${recipient.email}. You are still a member, but hold no permissions.`,
  };
}

// ---------------------------------------------------------------------------
// Closing
// ---------------------------------------------------------------------------

const closeSchema = z.object({
  storeId: z.uuid(),
  confirmation: z.string().trim(),
});

/**
 * Closes a store.
 *
 * Closed, not deleted. Orders reference the store with ON DELETE RESTRICT and
 * the ledger does too, so a hard delete is impossible without destroying the
 * financial record — which is the one thing that must survive. Closing hides
 * it from the storefront and stops new orders; everything already sold stays
 * exactly as it was.
 *
 * Refuses while there is money owed or work outstanding. A store that vanishes
 * with unfulfilled orders leaves buyers with nothing and no one to ask.
 */
export async function closeStoreAction(
  input: z.input<typeof closeSchema>,
): Promise<OwnerResult> {
  const parsed = closeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const data = parsed.data;

  const owner = await requireOwner(data.storeId);
  if (!owner) {
    return { ok: false, message: "Only the store owner can close a store." };
  }

  const [store] = await db
    .select({ id: stores.id, name: stores.name, status: stores.status })
    .from(stores)
    .where(eq(stores.id, data.storeId))
    .limit(1);
  if (!store) return { ok: false, message: "Store not found." };
  if (store.status === "closed") {
    return { ok: false, message: "Already closed." };
  }

  if (data.confirmation !== store.name) {
    return {
      ok: false,
      message: `Type the store name exactly — "${store.name}" — to confirm.`,
    };
  }

  const [{ open }] = await db
    .select({ open: sql<number>`count(*)::int` })
    .from(subOrders)
    .where(
      and(
        eq(subOrders.storeId, data.storeId),
        sql`${subOrders.status} in ('pending', 'accepted', 'shipped')`,
      ),
    );

  if (open > 0) {
    return {
      ok: false,
      message: `${open} ${open === 1 ? "order is" : "orders are"} still open. Ship or cancel them first.`,
    };
  }

  const balance = await storeBalance(db, data.storeId, "USD");
  if (Number(balance) > 0) {
    return {
      ok: false,
      message: `You are still owed ${(Number(balance) / 100).toFixed(2)}. Wait for the payout before closing.`,
    };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(stores)
      .set({ status: "closed" })
      .where(eq(stores.id, data.storeId));

    // Products are archived rather than deleted for the same reason as the
    // store: order items reference their variants.
    await tx
      .update(products)
      .set({ status: "archived", publishedAt: null })
      .where(eq(products.storeId, data.storeId));

    await tx.insert(auditLog).values({
      storeId: data.storeId,
      actorId: owner.userId,
      actorEmail: owner.email,
      action: "store.delete",
      targetType: "store",
      targetId: data.storeId,
      targetLabel: store.name,
      before: { status: store.status },
      after: { status: "closed" },
    });
  });

  revalidatePath("/dashboard");
  revalidatePath("/");
  return {
    ok: true,
    message: `${store.name} is closed. Past orders and their records are untouched.`,
  };
}
