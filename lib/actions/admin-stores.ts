"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePlatformPermission } from "@/lib/auth/access";
import { getSession } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import {
  auditLog,
  ledgerEntries,
  payouts,
  stores,
  user,
} from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { payoutNotice } from "@/lib/email/templates";
import { storeBalance } from "@/lib/money/ledger";

/**
 * Platform actions on stores: approval, suspension, and payouts.
 *
 * Payouts are the only place in the application where money leaves. Everything
 * about this file is shaped by that: the amount is recomputed from the ledger
 * rather than accepted from the form, the debit and the payout row are written
 * in one transaction, and a store cannot be paid more than it has earned even
 * if two admins press the button at the same moment.
 */

export type AdminResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

const statusSchema = z.object({
  storeId: z.uuid(),
  status: z.enum(["pending", "active", "suspended", "closed"]),
  reason: z.string().trim().max(300).optional(),
});

export async function setStoreStatusAction(
  input: z.input<typeof statusSchema>,
): Promise<AdminResult> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  // Approving and suspending are different powers. A moderator who can take a
  // bad store offline has no reason to be able to let new ones in.
  await requirePlatformPermission(
    data.status === "active"
      ? "platform.store.approve"
      : "platform.store.suspend",
  );

  const session = await getSession();
  if (!session) return { ok: false, message: "Not signed in." };

  const [store] = await db
    .select({
      id: stores.id,
      name: stores.name,
      slug: stores.slug,
      status: stores.status,
    })
    .from(stores)
    .where(eq(stores.id, data.storeId))
    .limit(1);
  if (!store) return { ok: false, message: "Store not found." };

  if (store.status === data.status) {
    return { ok: false, message: `Already ${data.status}.` };
  }

  // Suspending hides the store and its products from the storefront — that is
  // handled by the status filter in listProducts, not by touching the products
  // themselves, so restoring a store brings its catalogue back intact.
  if (data.status === "suspended" && !data.reason) {
    return { ok: false, message: "Give a reason when suspending a store." };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(stores)
      .set({ status: data.status })
      .where(eq(stores.id, data.storeId));

    await tx.insert(auditLog).values({
      storeId: data.storeId,
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: `platform.store.${data.status}`,
      targetType: "store",
      targetId: data.storeId,
      targetLabel: store.name,
      before: { status: store.status },
      after: { status: data.status, reason: data.reason ?? null },
    });
  });

  revalidatePath("/admin/stores");
  revalidatePath(`/store/${store.slug}`);
  revalidatePath("/");

  return { ok: true, message: `${store.name} is now ${data.status}.` };
}

// ---------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------

const payoutSchema = z.object({
  storeId: z.uuid(),
  currency: z.string().trim().length(3).default("USD"),
  /**
   * What the admin saw when they pressed the button.
   *
   * Not the amount that gets paid — that is recomputed. This is compared
   * against the recomputed figure so a balance that moved between rendering
   * the page and submitting it stops the payout rather than silently paying a
   * different number than the one on screen.
   */
  expectedCents: z.number().int().min(1),
});

export async function initiatePayoutAction(
  input: z.input<typeof payoutSchema>,
): Promise<AdminResult> {
  const parsed = payoutSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  await requirePlatformPermission("platform.payout.initiate");
  const session = await getSession();
  if (!session) return { ok: false, message: "Not signed in." };

  const [store] = await db
    .select({ id: stores.id, name: stores.name, status: stores.status })
    .from(stores)
    .where(eq(stores.id, data.storeId))
    .limit(1);
  if (!store) return { ok: false, message: "Store not found." };

  if (store.status !== "active") {
    return {
      ok: false,
      message: `${store.name} is ${store.status}. Resolve that before paying out.`,
    };
  }

  try {
    const result = await db.transaction(async (tx) => {
      // Locking the store row serialises payouts for it. Two admins pressing
      // the button at once would otherwise both read the same balance and both
      // pay it.
      await tx.execute(
        sql`select id from stores where id = ${data.storeId} for update`,
      );

      // Recomputed inside the lock. The number on the admin's screen is a
      // suggestion; this is the authority.
      const balance = await storeBalance(tx, data.storeId, data.currency);
      const amount = Number(balance);

      if (amount <= 0) {
        throw new PayoutRefused(`${store.name} has nothing owing.`);
      }
      if (amount !== data.expectedCents) {
        throw new PayoutRefused(
          "The balance changed while you were looking at it. Reload and check the new figure.",
        );
      }

      const [payout] = await tx
        .insert(payouts)
        .values({
          storeId: data.storeId,
          amountCents: BigInt(amount),
          currency: data.currency,
          status: "processing",
          initiatedAt: new Date(),
          periodEnd: new Date(),
        })
        .returning({ id: payouts.id });

      // The debit goes in the same transaction. A payout row without its
      // ledger entry would leave the balance still showing the money as owing,
      // and the next run would pay it again.
      await tx.insert(ledgerEntries).values({
        storeId: data.storeId,
        subOrderId: null,
        type: "payout",
        amountCents: BigInt(-amount),
        currency: data.currency,
        description: `Payout to ${store.name}`,
        idempotencyKey: `payout:${payout.id}`,
      });

      await tx.insert(auditLog).values({
        storeId: data.storeId,
        actorId: session.user.id,
        actorEmail: session.user.email,
        action: "platform.payout.initiate",
        targetType: "payout",
        targetId: payout.id,
        targetLabel: store.name,
        before: { balanceCents: amount },
        after: { payoutCents: amount, currency: data.currency },
      });

      return { payoutId: payout.id, amount };
    });

    // After the transaction. The seller is told money is coming only once the
    // ledger says it is, and a failed send does not undo the payout.
    await notifyPayout({
      storeId: data.storeId,
      storeName: store.name,
      amountCents: result.amount,
      currency: data.currency,
      reference: result.payoutId,
    });

    revalidatePath("/admin/payouts");
    revalidatePath(`/dashboard/${data.storeId}/payouts`);

    return {
      ok: true,
      message: `Sent ${(result.amount / 100).toFixed(2)} ${data.currency} to ${store.name}.`,
    };
  } catch (error) {
    if (error instanceof PayoutRefused) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
}

/** Thrown to roll the transaction back with a message meant for a person. */
class PayoutRefused extends Error {}

const settleSchema = z.object({
  payoutId: z.uuid(),
  status: z.enum(["paid", "failed"]),
  providerTransferId: z.string().trim().max(120).optional(),
  failureReason: z.string().trim().max(300).optional(),
});

/**
 * Confirms or fails a payout that is in flight.
 *
 * A failure returns the money to the seller's balance as a new positive entry,
 * never by deleting the debit. The ledger is append-only and the trigger
 * enforces it, so the history shows the payout went out and came back — which
 * is what actually happened.
 */
export async function settlePayoutAction(
  input: z.input<typeof settleSchema>,
): Promise<AdminResult> {
  const parsed = settleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  await requirePlatformPermission("platform.payout.initiate");
  const session = await getSession();
  if (!session) return { ok: false, message: "Not signed in." };

  const [payout] = await db
    .select()
    .from(payouts)
    .where(eq(payouts.id, data.payoutId))
    .limit(1);
  if (!payout) return { ok: false, message: "Payout not found." };

  if (payout.status !== "processing" && payout.status !== "pending") {
    return { ok: false, message: `That payout is already ${payout.status}.` };
  }

  if (data.status === "failed" && !data.failureReason) {
    return {
      ok: false,
      message: "Give a reason when marking a payout failed.",
    };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(payouts)
      .set({
        status: data.status,
        providerTransferId: data.providerTransferId || null,
        failureReason: data.failureReason || null,
        completedAt: new Date(),
      })
      .where(eq(payouts.id, data.payoutId));

    if (data.status === "failed") {
      await tx
        .insert(ledgerEntries)
        .values({
          storeId: payout.storeId,
          subOrderId: null,
          type: "adjustment",
          // Positive, and payouts.amount_cents is already stored positive.
          // The original debit was written as BigInt(-amount); negating the
          // stored figure here would debit the seller a second time instead
          // of returning money that never left.
          amountCents: payout.amountCents,
          currency: payout.currency,
          description: `Payout failed: ${data.failureReason}`,
          idempotencyKey: `payout-reversal:${payout.id}`,
        })
        .onConflictDoNothing({ target: ledgerEntries.idempotencyKey });
    }

    await tx.insert(auditLog).values({
      storeId: payout.storeId,
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: `platform.payout.${data.status}`,
      targetType: "payout",
      targetId: payout.id,
      before: { status: payout.status },
      after: {
        status: data.status,
        providerTransferId: data.providerTransferId ?? null,
        failureReason: data.failureReason ?? null,
      },
    });
  });

  revalidatePath("/admin/payouts");
  revalidatePath(`/dashboard/${payout.storeId}/payouts`);

  return {
    ok: true,
    message:
      data.status === "paid"
        ? "Marked paid."
        : "Marked failed and returned to the seller's balance.",
  };
}

/** Stores with money owing, for the payout run. */
export async function storesOwedAction() {
  await requirePlatformPermission("platform.payout.initiate");

  const rows = await db
    .select({
      storeId: stores.id,
      name: stores.name,
      slug: stores.slug,
      status: stores.status,
      balance: sql<string>`coalesce(sum(${ledgerEntries.amountCents}), 0)`,
      currency: sql<string>`coalesce(max(${ledgerEntries.currency}), 'USD')`,
      inFlight: sql<string>`(
        select coalesce(sum(p.amount_cents), 0)
        from payouts p
        where p.store_id = ${stores.id} and p.status in ('pending', 'processing')
      )`,
    })
    .from(stores)
    .leftJoin(ledgerEntries, eq(ledgerEntries.storeId, stores.id))
    .groupBy(stores.id, stores.name, stores.slug, stores.status)
    .orderBy(sql`coalesce(sum(${ledgerEntries.amountCents}), 0) desc`);

  return rows.map((row) => ({
    storeId: row.storeId,
    name: row.name,
    slug: row.slug,
    status: row.status,
    balanceCents: Number(row.balance),
    currency: row.currency,
    inFlightCents: Number(row.inFlight),
  }));
}

/** Recent payouts across every store. */
export async function recentPayoutsAction(limit = 40) {
  await requirePlatformPermission("platform.payout.initiate");

  return db
    .select({
      id: payouts.id,
      storeId: payouts.storeId,
      storeName: stores.name,
      amountCents: payouts.amountCents,
      currency: payouts.currency,
      status: payouts.status,
      providerTransferId: payouts.providerTransferId,
      failureReason: payouts.failureReason,
      initiatedAt: payouts.initiatedAt,
      completedAt: payouts.completedAt,
    })
    .from(payouts)
    .innerJoin(stores, eq(stores.id, payouts.storeId))
    .orderBy(sql`${payouts.createdAt} desc`)
    .limit(limit);
}

/** Stores awaiting a decision, plus the rest, for the approval queue. */
export async function listStoresForAdminAction() {
  await requirePlatformPermission("platform.store.view");

  return db
    .select({
      id: stores.id,
      name: stores.name,
      slug: stores.slug,
      status: stores.status,
      description: stores.description,
      createdAt: stores.createdAt,
      ownerEmail: sql<string>`(
        select u.email from "user" u where u.id = ${stores.ownerId}
      )`,
      productCount: sql<number>`(
        select count(*)::int from products p where p.store_id = ${stores.id}
      )`,
    })
    .from(stores)
    .orderBy(
      // Pending first — the queue exists to be cleared.
      sql`case when ${stores.status} = 'pending' then 0 else 1 end`,
      sql`${stores.createdAt} desc`,
    );
}

export async function storeBalanceForAdmin(storeId: string, currency = "USD") {
  await requirePlatformPermission("platform.payout.initiate");
  const balance = await storeBalance(db, z.uuid().parse(storeId), currency);
  return Number(balance);
}

/**
 * Tells a store owner money has been sent.
 *
 * The owner, not every staff member: a payout is the owner's business, and
 * mailing a warehouse account about the store's revenue is a disclosure nobody
 * asked for.
 */
async function notifyPayout(input: {
  storeId: string;
  storeName: string;
  amountCents: number;
  currency: string;
  reference: string;
}) {
  const [owner] = await db
    .select({ email: user.email })
    .from(stores)
    .innerJoin(user, eq(user.id, stores.ownerId))
    .where(eq(stores.id, input.storeId))
    .limit(1);

  if (!owner) return;

  await sendEmail(
    payoutNotice({
      to: owner.email,
      storeName: input.storeName,
      amountCents: input.amountCents,
      currency: input.currency,
      reference: input.reference,
    }),
  );
}
