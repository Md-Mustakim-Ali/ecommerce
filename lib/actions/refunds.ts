"use server";

import { and, desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  requirePlatformPermission,
  requireStorePermission,
} from "@/lib/auth/access";
import { getSession } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import {
  auditLog,
  orders,
  refundRequests,
  stores,
  subOrders,
} from "@/lib/db/schema";
import { recordRefund } from "@/lib/money/ledger";

/**
 * Refunds.
 *
 * Asking and approving are separate permissions, so they are separate actions
 * with separate call sites. A seller with `order.refund` creates a request and
 * nothing moves; only `platform.refund.approve` writes to the ledger. That
 * split is the whole point — a seller who could refund unilaterally could
 * drain their own balance to zero after being paid out.
 */

export type RefundResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

const requestSchema = z.object({
  storeId: z.uuid(),
  subOrderId: z.uuid(),
  /** Major units. Blank means the whole sub-order. */
  amount: z.string().trim().optional(),
  reason: z.string().trim().min(4, "Give a reason").max(300),
});

function toCents(value: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
}

export async function requestRefundAction(
  input: z.input<typeof requestSchema>,
): Promise<RefundResult> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  await requireStorePermission(data.storeId, "order.refund");
  const session = await getSession();
  if (!session) return { ok: false, message: "Not signed in." };

  const [sub] = await db
    .select({
      id: subOrders.id,
      status: subOrders.status,
      subtotalCents: subOrders.subtotalCents,
      shippingCents: subOrders.shippingCents,
      orderNumber: orders.orderNumber,
      currency: orders.currency,
      orderStatus: orders.status,
    })
    .from(subOrders)
    .innerJoin(orders, eq(orders.id, subOrders.orderId))
    .where(
      and(
        eq(subOrders.id, data.subOrderId),
        eq(subOrders.storeId, data.storeId),
      ),
    )
    .limit(1);

  if (!sub) return { ok: false, message: "Order not found." };

  // Nothing was ever collected on an unpaid order, so there is nothing to
  // give back — cancelling is the right action there.
  if (sub.orderStatus === "pending") {
    return {
      ok: false,
      message: "This order has not been paid. Cancel it instead.",
    };
  }
  if (sub.status === "refunded") {
    return { ok: false, message: "Already refunded." };
  }

  const gross = sub.subtotalCents + sub.shippingCents;
  const amount =
    data.amount && data.amount !== "" ? toCents(data.amount) : gross;

  if (amount === null || amount <= 0) {
    return { ok: false, message: "Enter an amount like 12.50." };
  }
  if (amount > gross) {
    return {
      ok: false,
      message: `That is more than the ${(gross / 100).toFixed(2)} charged on this order.`,
    };
  }

  // Everything already asked for, so a second request cannot take the total
  // past what was collected.
  const [{ pending }] = await db
    .select({
      pending: sql<number>`coalesce(sum(${refundRequests.amountCents}), 0)::int`,
    })
    .from(refundRequests)
    .where(
      and(
        eq(refundRequests.subOrderId, data.subOrderId),
        sql`${refundRequests.status} in ('requested', 'approved')`,
      ),
    );

  if (pending + amount > gross) {
    return {
      ok: false,
      message: `${(pending / 100).toFixed(2)} is already requested or refunded on this order.`,
    };
  }

  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(refundRequests)
      .values({
        subOrderId: data.subOrderId,
        storeId: data.storeId,
        amountCents: amount,
        currency: sub.currency,
        reason: data.reason,
        requestedBy: session.user.id,
      })
      .returning({ id: refundRequests.id });

    await tx.insert(auditLog).values({
      storeId: data.storeId,
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: "order.refund.request",
      targetType: "refund_request",
      targetId: created.id,
      targetLabel: sub.orderNumber,
      before: null,
      after: { amountCents: amount, reason: data.reason },
    });
  });

  revalidatePath(`/dashboard/${data.storeId}/orders`);
  revalidatePath("/admin/refunds");

  return {
    ok: true,
    message: `Requested ${(amount / 100).toFixed(2)}. Money moves once the platform approves it.`,
  };
}

const reviewSchema = z.object({
  requestId: z.uuid(),
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().max(300).optional(),
});

/**
 * Approves or rejects a request.
 *
 * Approving is what actually writes the ledger entries, through the same
 * recordRefund the rest of the money code uses — a negative refund entry plus
 * a proportional commission return, never an edit to the original sale.
 */
export async function reviewRefundAction(
  input: z.input<typeof reviewSchema>,
): Promise<RefundResult> {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  await requirePlatformPermission("platform.refund.approve");
  const session = await getSession();
  if (!session) return { ok: false, message: "Not signed in." };

  if (data.decision === "rejected" && !data.note) {
    return { ok: false, message: "Give a reason when rejecting." };
  }

  const [request] = await db
    .select()
    .from(refundRequests)
    .where(eq(refundRequests.id, data.requestId))
    .limit(1);

  if (!request) return { ok: false, message: "Request not found." };
  if (request.status !== "requested") {
    return { ok: false, message: `Already ${request.status}.` };
  }

  if (data.decision === "approved") {
    // The ledger write happens first. If it fails — the amount exceeds what
    // was charged, say — the request stays open rather than being marked
    // approved with no money having moved.
    const result = await recordRefund(db, {
      subOrderId: request.subOrderId,
      amountCents: request.amountCents,
      reason: request.reason,
      idempotencyKey: request.id,
    });

    if (!result.recorded) {
      return {
        ok: false,
        message: "That refund was already recorded on the ledger.",
      };
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(refundRequests)
      .set({
        status: data.decision,
        reviewedBy: session.user.id,
        reviewNote: data.note || null,
        reviewedAt: new Date(),
      })
      .where(eq(refundRequests.id, data.requestId));

    await tx.insert(auditLog).values({
      storeId: request.storeId,
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: `platform.refund.${data.decision}`,
      targetType: "refund_request",
      targetId: request.id,
      before: { status: "requested" },
      after: {
        status: data.decision,
        amountCents: request.amountCents,
        note: data.note ?? null,
      },
    });
  });

  revalidatePath("/admin/refunds");
  revalidatePath(`/dashboard/${request.storeId}/orders`);
  revalidatePath(`/dashboard/${request.storeId}/payouts`);

  return {
    ok: true,
    message:
      data.decision === "approved"
        ? `Refunded ${(request.amountCents / 100).toFixed(2)}.`
        : "Rejected.",
  };
}

/** Requests awaiting a decision, plus recent ones, for the admin queue. */
export async function listRefundRequestsAction() {
  await requirePlatformPermission("platform.refund.approve");

  return db
    .select({
      id: refundRequests.id,
      subOrderId: refundRequests.subOrderId,
      storeName: stores.name,
      orderNumber: orders.orderNumber,
      buyerEmail: orders.email,
      buyerPhone: orders.contactPhone,
      amountCents: refundRequests.amountCents,
      currency: refundRequests.currency,
      reason: refundRequests.reason,
      status: refundRequests.status,
      reviewNote: refundRequests.reviewNote,
      createdAt: refundRequests.createdAt,
      subtotalCents: subOrders.subtotalCents,
      shippingCents: subOrders.shippingCents,
    })
    .from(refundRequests)
    .innerJoin(subOrders, eq(subOrders.id, refundRequests.subOrderId))
    .innerJoin(orders, eq(orders.id, subOrders.orderId))
    .innerJoin(stores, eq(stores.id, refundRequests.storeId))
    .orderBy(
      // Open requests first — the queue exists to be cleared.
      sql`case when ${refundRequests.status} = 'requested' then 0 else 1 end`,
      desc(refundRequests.createdAt),
    )
    .limit(100);
}

/** Requests on a store's own orders, for the seller's order list. */
export async function listStoreRefundsAction(storeId: string) {
  const id = z.uuid().parse(storeId);
  await requireStorePermission(id, "order.view");

  return db
    .select({
      id: refundRequests.id,
      subOrderId: refundRequests.subOrderId,
      amountCents: refundRequests.amountCents,
      status: refundRequests.status,
      reason: refundRequests.reason,
      reviewNote: refundRequests.reviewNote,
    })
    .from(refundRequests)
    .where(eq(refundRequests.storeId, id));
}
