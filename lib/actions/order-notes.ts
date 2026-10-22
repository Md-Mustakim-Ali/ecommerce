"use server";

import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStorePermission } from "@/lib/auth/access";
import { getSession } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { auditLog, orderNotes, orders, subOrders } from "@/lib/db/schema";

/**
 * Notes and buyer messages on an order.
 *
 * Two permissions, one table. `order.note` writes something only the store
 * sees; `customer.contact` writes something the buyer sees on their own order
 * page. The permission is chosen by the visibility asked for, so a role that
 * can annotate an order internally cannot accidentally send that annotation to
 * the customer — which is the actual failure mode worth designing against.
 *
 * The buyer's own replies need no permission. It is their order.
 */

export type NoteResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

const postSchema = z.object({
  storeId: z.uuid(),
  subOrderId: z.uuid(),
  body: z.string().trim().min(1, "Write something first.").max(4000),
  visibility: z.enum(["internal", "buyer"]),
});

export async function postOrderNoteAction(
  input: z.input<typeof postSchema>,
): Promise<NoteResult> {
  const parsed = postSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  // The permission follows the audience, not the action.
  await requireStorePermission(
    data.storeId,
    data.visibility === "buyer" ? "customer.contact" : "order.note",
  );

  const session = await getSession();
  if (!session) return { ok: false, message: "Not signed in." };

  // Scoped through the store, so a sub-order id belonging to another seller
  // does not resolve however valid the uuid is.
  const [sub] = await db
    .select({ id: subOrders.id, orderId: subOrders.orderId })
    .from(subOrders)
    .where(
      and(
        eq(subOrders.id, data.subOrderId),
        eq(subOrders.storeId, data.storeId),
      ),
    )
    .limit(1);
  if (!sub) return { ok: false, message: "Order not found." };

  await db.insert(orderNotes).values({
    subOrderId: sub.id,
    authorRole: "staff",
    visibility: data.visibility,
    authorId: session.user.id,
    authorName: session.user.name || session.user.email,
    body: data.body,
  });

  // Only messages to the buyer are audited. An internal note is a working
  // scratchpad; logging every one of them would bury the entries that matter
  // in a log support actually has to read.
  if (data.visibility === "buyer") {
    await db.insert(auditLog).values({
      storeId: data.storeId,
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: "customer.contact",
      targetType: "sub_order",
      targetId: sub.id,
      after: { length: data.body.length },
    });
  }

  revalidatePath(`/dashboard/${data.storeId}/orders`);
  revalidatePath(`/orders/${sub.orderId}`);
  return {
    ok: true,
    message: data.visibility === "buyer" ? "Sent to the buyer." : "Note saved.",
  };
}

const deleteSchema = z.object({ storeId: z.uuid(), noteId: z.uuid() });

/**
 * Deletes an internal note.
 *
 * Only internal ones, and only your own. A message the buyer has already read
 * cannot be unsent — removing it would leave them holding a conversation the
 * store has no record of, which is worse for everyone than a visible mistake.
 */
export async function deleteOrderNoteAction(
  input: z.input<typeof deleteSchema>,
): Promise<NoteResult> {
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const data = parsed.data;

  await requireStorePermission(data.storeId, "order.note");
  const session = await getSession();
  if (!session) return { ok: false, message: "Not signed in." };

  const [note] = await db
    .select({
      id: orderNotes.id,
      visibility: orderNotes.visibility,
      authorId: orderNotes.authorId,
      subOrderId: orderNotes.subOrderId,
    })
    .from(orderNotes)
    .innerJoin(subOrders, eq(subOrders.id, orderNotes.subOrderId))
    .where(
      and(eq(orderNotes.id, data.noteId), eq(subOrders.storeId, data.storeId)),
    )
    .limit(1);

  if (!note) return { ok: false, message: "Note not found." };
  if (note.visibility === "buyer") {
    return { ok: false, message: "A message to the buyer cannot be unsent." };
  }
  if (note.authorId !== session.user.id) {
    return { ok: false, message: "You can only remove your own notes." };
  }

  await db.delete(orderNotes).where(eq(orderNotes.id, data.noteId));
  revalidatePath(`/dashboard/${data.storeId}/orders`);
  return { ok: true, message: "Note removed." };
}

const replySchema = z.object({
  subOrderId: z.uuid(),
  body: z.string().trim().min(1, "Write something first.").max(4000),
});

/**
 * The buyer's side of the thread.
 *
 * Ownership of the order is the authorisation — checked by joining through to
 * `orders.buyer_id` rather than trusting the sub-order id, which is only a
 * uuid the page happened to render.
 */
export async function replyToStoreAction(
  input: z.input<typeof replySchema>,
): Promise<NoteResult> {
  const parsed = replySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  const session = await getSession();
  if (!session) return { ok: false, message: "Sign in to reply." };

  const [sub] = await db
    .select({ id: subOrders.id, orderId: subOrders.orderId })
    .from(subOrders)
    .innerJoin(orders, eq(orders.id, subOrders.orderId))
    .where(
      and(
        eq(subOrders.id, data.subOrderId),
        eq(orders.buyerId, session.user.id),
      ),
    )
    .limit(1);
  if (!sub) return { ok: false, message: "Order not found." };

  await db.insert(orderNotes).values({
    subOrderId: sub.id,
    authorRole: "buyer",
    // A buyer cannot write an internal note, so there is nothing to choose.
    visibility: "buyer",
    authorId: session.user.id,
    authorName: session.user.name || session.user.email,
    body: data.body,
  });

  revalidatePath(`/orders/${sub.orderId}`);
  return { ok: true, message: "Sent." };
}

/**
 * Marks the other side's messages as read.
 *
 * Only the ones you did not write — otherwise opening your own thread would
 * mark your unanswered question as read, which is exactly backwards.
 */
export async function markThreadReadAction(input: {
  subOrderId: string;
  as: "staff" | "buyer";
}): Promise<NoteResult> {
  const subOrderId = z.uuid().safeParse(input.subOrderId);
  if (!subOrderId.success) return { ok: false, message: "Invalid request." };

  const session = await getSession();
  if (!session) return { ok: false, message: "Not signed in." };

  if (input.as === "buyer") {
    const [sub] = await db
      .select({ id: subOrders.id })
      .from(subOrders)
      .innerJoin(orders, eq(orders.id, subOrders.orderId))
      .where(
        and(
          eq(subOrders.id, subOrderId.data),
          eq(orders.buyerId, session.user.id),
        ),
      )
      .limit(1);
    if (!sub) return { ok: false, message: "Order not found." };
  } else {
    const [sub] = await db
      .select({ storeId: subOrders.storeId })
      .from(subOrders)
      .where(eq(subOrders.id, subOrderId.data))
      .limit(1);
    if (!sub) return { ok: false, message: "Order not found." };
    await requireStorePermission(sub.storeId, "order.view");
  }

  await db
    .update(orderNotes)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(orderNotes.subOrderId, subOrderId.data),
        eq(orderNotes.visibility, "buyer"),
        ne(orderNotes.authorRole, input.as),
        isNull(orderNotes.readAt),
      ),
    );

  return { ok: true, message: "Read." };
}

export type OrderNote = {
  id: string;
  authorRole: "staff" | "buyer";
  visibility: "internal" | "buyer";
  authorName: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  mine: boolean;
};

/**
 * The thread for one sub-order, from the store's side.
 *
 * Everything, including internal notes — which is why it takes `order.view`
 * and scopes by store rather than accepting a sub-order id on trust.
 */
export async function listNotesForStore(
  storeId: string,
  subOrderId: string,
): Promise<OrderNote[]> {
  await requireStorePermission(storeId, "order.view");
  const session = await getSession();

  const rows = await db
    .select({
      id: orderNotes.id,
      authorRole: orderNotes.authorRole,
      visibility: orderNotes.visibility,
      authorId: orderNotes.authorId,
      authorName: orderNotes.authorName,
      body: orderNotes.body,
      createdAt: orderNotes.createdAt,
      readAt: orderNotes.readAt,
    })
    .from(orderNotes)
    .innerJoin(subOrders, eq(subOrders.id, orderNotes.subOrderId))
    .where(
      and(
        eq(orderNotes.subOrderId, subOrderId),
        eq(subOrders.storeId, storeId),
      ),
    )
    .orderBy(asc(orderNotes.createdAt));

  return rows.map((row) => ({
    id: row.id,
    authorRole: row.authorRole,
    visibility: row.visibility,
    authorName: row.authorName,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
    mine: !!session && row.authorId === session.user.id,
  }));
}
