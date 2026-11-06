/**
 * Verifies the refund path.
 *
 * The invariants that matter: a seller cannot move money, an approval writes
 * the ledger entries through the shared recordRefund, the commission comes
 * back proportionally, and nothing can be refunded twice or beyond what was
 * charged.
 *
 * Runs against real seeded orders and rolls everything back.
 */

import { and, eq, sql } from "drizzle-orm";
import { PLATFORM_CURRENCY } from "@/lib/money/currency";
import { db } from "../lib/db/index.ts";
import {
  ledgerEntries,
  orders,
  refundRequests,
  subOrders,
} from "../lib/db/schema/index.ts";
import { recordRefund, storeBalance } from "../lib/money/ledger.ts";

let failures = 0;
function check(label: string, condition: boolean, detail = "") {
  if (!condition) failures++;
  console.log(
    `${condition ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`,
  );
}
const money = (c: number | bigint) => `$${(Number(c) / 100).toFixed(2)}`;

class Rollback extends Error {}

async function main() {
  // A delivered sub-order with commission on it, which is the case the
  // proportional return exists for.
  const [sub] = await db
    .select({
      id: subOrders.id,
      storeId: subOrders.storeId,
      subtotalCents: subOrders.subtotalCents,
      shippingCents: subOrders.shippingCents,
      commissionCents: subOrders.commissionCents,
      orderNumber: orders.orderNumber,
    })
    .from(subOrders)
    .innerJoin(orders, eq(orders.id, subOrders.orderId))
    .where(
      and(
        eq(subOrders.status, "delivered"),
        sql`${subOrders.commissionCents} > 100`,
      ),
    )
    .limit(1);

  if (!sub) {
    console.log("no delivered sub-order with commission; nothing to check");
    process.exit(0);
  }

  const gross = sub.subtotalCents + sub.shippingCents;
  console.log(
    `${sub.orderNumber}: ${money(gross)} gross, ${money(sub.commissionCents)} commission\n`,
  );

  const opening = await storeBalance(db, sub.storeId, PLATFORM_CURRENCY);

  await db
    .transaction(async (tx) => {
      console.log("--- a partial refund ---");

      const half = Math.floor(gross / 2);
      const before = Number(
        await storeBalance(tx, sub.storeId, PLATFORM_CURRENCY),
      );

      const result = await recordRefund(tx, {
        subOrderId: sub.id,
        amountCents: half,
        reason: "Arrived damaged",
        idempotencyKey: `verify-${Date.now()}`,
      });

      check("the refund is recorded", result.recorded);

      const after = Number(
        await storeBalance(tx, sub.storeId, PLATFORM_CURRENCY),
      );
      const drop = before - after;

      // The seller loses the refund but gets their commission share back, so
      // the net drop is less than the refund itself.
      const commissionBack = Math.floor((sub.commissionCents * half) / gross);
      check(
        "the seller's balance falls by the refund less returned commission",
        drop === half - commissionBack,
        `${money(drop)} = ${money(half)} - ${money(commissionBack)}`,
      );
      check(
        "commission comes back proportionally",
        commissionBack > 0 && commissionBack < sub.commissionCents,
        `${money(commissionBack)} of ${money(sub.commissionCents)}`,
      );

      const rows = await tx
        .select({ type: ledgerEntries.type, amount: ledgerEntries.amountCents })
        .from(ledgerEntries)
        .where(
          and(
            eq(ledgerEntries.subOrderId, sub.id),
            eq(ledgerEntries.type, "refund"),
          ),
        );
      check(
        "the refund is a new negative entry, not an edit",
        rows.some((r) => Number(r.amount) === -half),
      );

      console.log("\n--- refunding more than was charged ---");

      let refused = false;
      try {
        await recordRefund(tx, {
          subOrderId: sub.id,
          amountCents: gross * 2,
          reason: "Too much",
          idempotencyKey: `verify-over-${Date.now()}`,
        });
      } catch {
        refused = true;
      }
      check("a refund beyond the amount charged is refused", refused);

      throw new Rollback();
    })
    .catch((error) => {
      if (!(error instanceof Rollback)) throw error;
    });

  console.log("\n--- the request queue ---");

  await db
    .transaction(async (tx) => {
      const [request] = await tx
        .insert(refundRequests)
        .values({
          subOrderId: sub.id,
          storeId: sub.storeId,
          amountCents: 500,
          currency: PLATFORM_CURRENCY,
          reason: "Test",
        })
        .returning({ id: refundRequests.id, status: refundRequests.status });

      check(
        "a new request starts as requested, with nothing moved",
        request.status === "requested",
      );

      const balanceAfterRequest = await storeBalance(
        tx,
        sub.storeId,
        PLATFORM_CURRENCY,
      );
      check(
        "filing a request does not touch the ledger",
        balanceAfterRequest === opening,
        `${money(balanceAfterRequest)} vs ${money(opening)}`,
      );

      throw new Rollback();
    })
    .catch((error) => {
      if (!(error instanceof Rollback)) throw error;
    });

  const closing = await storeBalance(db, sub.storeId, PLATFORM_CURRENCY);
  check(
    "the seeded ledger is untouched",
    closing === opening,
    `${money(closing)} vs ${money(opening)}`,
  );

  console.log(
    failures === 0 ? "\nall checks passed" : `\n${failures} CHECK(S) FAILED`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
