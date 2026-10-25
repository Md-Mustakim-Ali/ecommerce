/**
 * Verifies order notes and buyer messages.
 *
 * The claim being tested is narrow and worth being sure of: an internal note
 * must never reach the buyer. Everything else here is secondary — if the
 * filter is wrong, a store's private remarks about a customer end up on that
 * customer's order page.
 *
 * Rolls back. Nothing survives the run.
 */

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../lib/db/index.ts";
import {
  orderNotes,
  orders,
  stores,
  subOrders,
  user,
} from "../lib/db/schema/index.ts";

let failures = 0;
function check(label: string, condition: boolean, detail = "") {
  if (!condition) failures++;
  console.log(
    `${condition ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`,
  );
}

async function main() {
  await db
    .transaction(async (tx) => {
      // A real order with more than one seller, so isolation between two
      // stores on the same order is tested rather than assumed.
      const rows = await tx
        .select({
          subOrderId: subOrders.id,
          orderId: subOrders.orderId,
          storeId: subOrders.storeId,
          storeName: stores.name,
          buyerId: orders.buyerId,
          orderNumber: orders.orderNumber,
        })
        .from(subOrders)
        .innerJoin(orders, eq(orders.id, subOrders.orderId))
        .innerJoin(stores, eq(stores.id, subOrders.storeId))
        .orderBy(asc(subOrders.orderId))
        .limit(400);

      const byOrder = new Map<string, typeof rows>();
      for (const row of rows) {
        const list = byOrder.get(row.orderId) ?? [];
        list.push(row);
        byOrder.set(row.orderId, list);
      }
      const split = [...byOrder.values()].find(
        (list) => list.length > 1 && list[0].buyerId,
      );
      if (!split) throw new Error("no multi-store order with a buyer in seed");

      const [first, second] = split;
      const [buyer] = await tx
        .select({ id: user.id, email: user.email })
        .from(user)
        .where(eq(user.id, first.buyerId as string));

      console.log(
        `order ${first.orderNumber} — ${first.storeName} + ${second.storeName}, buyer ${buyer.email}\n`,
      );

      // --- one thread, both kinds ------------------------------------------
      await tx.insert(orderNotes).values([
        {
          subOrderId: first.subOrderId,
          authorRole: "staff",
          visibility: "internal",
          authorName: "Warehouse",
          body: "Buyer has chargebacked twice. Ship signed-for only.",
        },
        {
          subOrderId: first.subOrderId,
          authorRole: "staff",
          visibility: "buyer",
          authorName: "Support",
          body: "Your parcel goes out tomorrow.",
        },
        {
          subOrderId: first.subOrderId,
          authorRole: "buyer",
          visibility: "buyer",
          authorName: buyer.email,
          body: "Can you leave it with a neighbour?",
        },
      ]);

      // The other seller on the same order writes their own note.
      await tx.insert(orderNotes).values({
        subOrderId: second.subOrderId,
        authorRole: "staff",
        visibility: "internal",
        authorName: "Other store",
        body: "Nothing to do with the first seller.",
      });

      // --- what the store sees ---------------------------------------------
      const storeView = await tx
        .select({
          visibility: orderNotes.visibility,
          authorRole: orderNotes.authorRole,
          body: orderNotes.body,
        })
        .from(orderNotes)
        .innerJoin(subOrders, eq(subOrders.id, orderNotes.subOrderId))
        .where(
          and(
            eq(orderNotes.subOrderId, first.subOrderId),
            eq(subOrders.storeId, first.storeId),
          ),
        );

      check("the store sees its whole thread", storeView.length === 3);
      check(
        "including the internal note",
        storeView.some((n) => n.visibility === "internal"),
      );

      // --- what the buyer sees ---------------------------------------------
      const subIds = split.map((row) => row.subOrderId);
      const buyerView = await tx
        .select({
          subOrderId: orderNotes.subOrderId,
          visibility: orderNotes.visibility,
          body: orderNotes.body,
        })
        .from(orderNotes)
        .where(
          and(
            inArray(orderNotes.subOrderId, subIds),
            eq(orderNotes.visibility, "buyer"),
          ),
        );

      check(
        "the buyer sees only the buyer-visible messages",
        buyerView.length === 2,
        `${buyerView.length} of 4 rows`,
      );
      check(
        "no internal note reaches the buyer",
        buyerView.every((n) => n.visibility === "buyer"),
      );
      check(
        "the chargeback note in particular is not there",
        !buyerView.some((n) => n.body.includes("chargeback")),
      );

      // --- isolation between two sellers on one order ----------------------
      //
      // Scoped to this order, not to the whole store. An earlier version
      // counted every note the second store had ever received and asserted it
      // was one — which held only while no real notes existed, and started
      // failing the moment somebody wrote one through the interface. A test
      // that depends on the rest of the database being empty is a test that
      // will be deleted rather than fixed.
      const otherSellerView = await tx
        .select({ id: orderNotes.id })
        .from(orderNotes)
        .innerJoin(subOrders, eq(subOrders.id, orderNotes.subOrderId))
        .where(
          and(
            eq(subOrders.storeId, second.storeId),
            eq(subOrders.orderId, second.orderId),
          ),
        );

      check(
        "the second seller sees only their own note on this order",
        otherSellerView.length === 1,
        `${otherSellerView.length} row`,
      );

      const crossStore = await tx
        .select({ id: orderNotes.id })
        .from(orderNotes)
        .innerJoin(subOrders, eq(subOrders.id, orderNotes.subOrderId))
        .where(
          and(
            eq(orderNotes.subOrderId, first.subOrderId),
            eq(subOrders.storeId, second.storeId),
          ),
        );
      check(
        "the first seller's thread is unreachable from the second's store id",
        crossStore.length === 0,
      );

      // --- unread counting --------------------------------------------------
      const unread = await tx
        .select({ id: orderNotes.id, authorRole: orderNotes.authorRole })
        .from(orderNotes)
        .where(
          and(
            eq(orderNotes.subOrderId, first.subOrderId),
            eq(orderNotes.authorRole, "buyer"),
          ),
        );
      check(
        "the buyer's message counts as unread until opened",
        unread.length === 1,
      );

      // --- cascade ----------------------------------------------------------
      // Notes hang off the sub-order. If that is ever removed the thread goes
      // with it rather than being orphaned by a foreign key error.
      const cascade = await tx.execute<{ delete_rule: string }>(
        sql`select delete_rule from information_schema.referential_constraints
            where constraint_name = 'order_notes_sub_order_id_sub_orders_id_fk'`,
      );
      check(
        "deleting a sub-order takes its notes with it",
        cascade[0]?.delete_rule === "CASCADE",
        cascade[0]?.delete_rule ?? "no constraint",
      );

      console.log(
        failures === 0
          ? "\nall checks passed"
          : `\n${failures} CHECK(S) FAILED`,
      );

      // Nothing here should survive.
      throw new ROLLBACK();
    })
    .catch((error) => {
      if (!(error instanceof ROLLBACK)) throw error;
    });

  process.exit(failures === 0 ? 0 : 1);
}

class ROLLBACK extends Error {}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
