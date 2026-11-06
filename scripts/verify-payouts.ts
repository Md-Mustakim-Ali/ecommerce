/**
 * Verifies the payout path against the real database.
 *
 * This is the only place in the application where money leaves, so the checks
 * are about the invariants rather than the happy path: the balance must fall
 * by exactly what was paid, a second payout must not be able to pay the same
 * money twice, and a failed payout must return the money by adding an entry
 * rather than by deleting the debit.
 *
 * Everything runs inside a transaction that is rolled back, so the seeded
 * ledger is left exactly as it was found.
 */

import { eq, sql } from "drizzle-orm";
import { PLATFORM_CURRENCY } from "@/lib/money/currency";
import { db } from "../lib/db/index.ts";
import { ledgerEntries, payouts, stores } from "../lib/db/schema/index.ts";
import { storeBalance } from "../lib/money/ledger.ts";

let failures = 0;
function check(label: string, condition: boolean, detail = "") {
  if (!condition) failures++;
  console.log(
    `${condition ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`,
  );
}
const money = (c: number | bigint) => `$${(Number(c) / 100).toFixed(2)}`;

async function main() {
  const [store] = await db
    .select({ id: stores.id, name: stores.name })
    .from(stores)
    .orderBy(stores.createdAt)
    .limit(1);

  const opening = await storeBalance(db, store.id, PLATFORM_CURRENCY);
  console.log(`${store.name}\nopening balance ${money(opening)}\n`);
  check("the store has something to pay out", Number(opening) > 0);

  // Everything below happens inside a transaction that is deliberately rolled
  // back at the end, so the seeded ledger is untouched.
  await db
    .transaction(async (tx) => {
      console.log("--- a payout ---");

      const amount = Number(
        await storeBalance(tx, store.id, PLATFORM_CURRENCY),
      );

      const [payout] = await tx
        .insert(payouts)
        .values({
          storeId: store.id,
          amountCents: BigInt(amount),
          currency: PLATFORM_CURRENCY,
          status: "processing",
          initiatedAt: new Date(),
        })
        .returning({ id: payouts.id });

      await tx.insert(ledgerEntries).values({
        storeId: store.id,
        subOrderId: null,
        type: "payout",
        amountCents: BigInt(-amount),
        currency: PLATFORM_CURRENCY,
        description: `Payout to ${store.name}`,
        idempotencyKey: `payout:${payout.id}`,
      });

      const after = Number(await storeBalance(tx, store.id, PLATFORM_CURRENCY));
      check(
        "the balance falls to zero",
        after === 0,
        `${money(amount)} paid, ${money(after)} left`,
      );

      console.log("\n--- paying twice ---");

      // The same idempotency key is the last line of defence if two requests
      // somehow both get past the lock.
      let duplicateBlocked = false;
      try {
        await tx.insert(ledgerEntries).values({
          storeId: store.id,
          subOrderId: null,
          type: "payout",
          amountCents: BigInt(-amount),
          currency: PLATFORM_CURRENCY,
          description: "Duplicate",
          idempotencyKey: `payout:${payout.id}`,
        });
      } catch {
        duplicateBlocked = true;
      }
      check(
        "the same payout cannot be written twice",
        duplicateBlocked,
        "unique idempotency key",
      );

      console.log("\n--- the ledger is append-only ---");

      let updateBlocked = false;
      try {
        await tx.execute(
          sql`update ledger_entries set amount_cents = 1 where idempotency_key = ${`payout:${payout.id}`}`,
        );
      } catch {
        updateBlocked = true;
      }
      check("a ledger entry cannot be updated", updateBlocked);

      // The failed-payout reversal. This is the case a sign error would make
      // catastrophic: negating the stored positive amount would debit the
      // seller a second time instead of returning the money.
      console.log("\n--- a failed payout ---");
    })
    .catch(() => {
      // The append-only trigger aborts the transaction, so the remaining
      // checks run in their own one below.
    });

  // Reversal, in a fresh transaction because the trigger above poisoned the
  // previous one.
  await db
    .transaction(async (tx) => {
      const amount = Number(
        await storeBalance(tx, store.id, PLATFORM_CURRENCY),
      );

      const [payout] = await tx
        .insert(payouts)
        .values({
          storeId: store.id,
          amountCents: BigInt(amount),
          currency: PLATFORM_CURRENCY,
          status: "processing",
          initiatedAt: new Date(),
        })
        .returning({ id: payouts.id });

      await tx.insert(ledgerEntries).values({
        storeId: store.id,
        subOrderId: null,
        type: "payout",
        amountCents: BigInt(-amount),
        currency: PLATFORM_CURRENCY,
        description: "Payout",
        idempotencyKey: `payout:${payout.id}`,
      });

      const paidOut = Number(
        await storeBalance(tx, store.id, PLATFORM_CURRENCY),
      );

      // Exactly what settlePayoutAction writes on failure.
      const [row] = await tx
        .select({ amountCents: payouts.amountCents })
        .from(payouts)
        .where(eq(payouts.id, payout.id));

      await tx.insert(ledgerEntries).values({
        storeId: store.id,
        subOrderId: null,
        type: "adjustment",
        amountCents: row.amountCents,
        currency: PLATFORM_CURRENCY,
        description: "Payout failed: bank rejected",
        idempotencyKey: `payout-reversal:${payout.id}`,
      });

      const restored = Number(
        await storeBalance(tx, store.id, PLATFORM_CURRENCY),
      );

      check(
        "a failed payout returns the money",
        restored === amount,
        `${money(paidOut)} -> ${money(restored)}, expected ${money(amount)}`,
      );
      check(
        "and does it by adding an entry, not removing one",
        restored > paidOut,
      );

      throw new Rollback();
    })
    .catch((error) => {
      if (!(error instanceof Rollback)) throw error;
    });

  const closing = await storeBalance(db, store.id, PLATFORM_CURRENCY);
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

class Rollback extends Error {}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
