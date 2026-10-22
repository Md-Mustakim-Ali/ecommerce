/**
 * Verifies that changing the commission rate affects new orders only.
 *
 * This is the invariant that makes the setting safe to touch: an order's
 * commission is snapshotted onto the sub-order at purchase time, so raising or
 * lowering the platform rate must never restate what a past order earned or
 * move a seller's balance.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "../lib/db/index.ts";
import { platformSettings, subOrders } from "../lib/db/schema/index.ts";
import { buildOrderTotals } from "../lib/money/order-math.ts";
import { getPlatformSettings } from "../lib/settings/index.ts";

let failures = 0;
function check(label: string, condition: boolean, detail = "") {
  if (!condition) failures++;
  console.log(
    `${condition ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`,
  );
}

class Rollback extends Error {}

async function main() {
  const original = await getPlatformSettings();
  console.log(
    `commission ${(original.commissionBps / 100).toFixed(2)}% · flat shipping $${(original.flatShippingCents / 100).toFixed(2)} · free above $${(original.freeShippingThresholdCents / 100).toFixed(2)}\n`,
  );

  check("settings load from the database", original.commissionBps > 0);

  // What every existing sub-order recorded, before anything changes.
  const [{ total: beforeTotal, count }] = await db
    .select({
      total: sql<string>`coalesce(sum(${subOrders.commissionCents}), 0)`,
      count: sql<number>`count(*)::int`,
    })
    .from(subOrders);

  console.log(`--- changing the rate ---`);

  await db
    .transaction(async (tx) => {
      await tx
        .update(platformSettings)
        .set({ commissionBps: 2500 })
        .where(eq(platformSettings.id, "default"));

      const [row] = await tx
        .select({ bps: platformSettings.commissionBps })
        .from(platformSettings)
        .where(eq(platformSettings.id, "default"));

      check("the new rate is stored", row.bps === 2500, `${row.bps} bps`);

      // A new order priced at the new rate.
      const totals = buildOrderTotals({
        lines: [
          {
            variantId: "v1",
            storeId: "s1",
            unitPriceCents: 10_000,
            quantity: 1,
          },
        ],
        shippingCents: 0,
        commissionBps: row.bps,
      });
      check(
        "a new order uses the new rate",
        totals.subOrders[0].commissionCents === 2500,
        `$${(totals.subOrders[0].commissionCents / 100).toFixed(2)} of $100.00`,
      );

      // Existing sub-orders must be untouched by the rate change.
      const [{ total: afterTotal }] = await tx
        .select({
          total: sql<string>`coalesce(sum(${subOrders.commissionCents}), 0)`,
        })
        .from(subOrders);

      check(
        "past orders keep the commission they were charged",
        afterTotal === beforeTotal,
        `${count} sub-orders, $${(Number(beforeTotal) / 100).toFixed(2)} unchanged`,
      );

      throw new Rollback();
    })
    .catch((error) => {
      if (!(error instanceof Rollback)) throw error;
    });

  console.log("\n--- the rate is bounded ---");

  let rejected = false;
  try {
    await db
      .transaction(async (tx) => {
        // The CHECK constraint, not application code, is what stops a rate
        // above 100%.
        await tx
          .update(platformSettings)
          .set({ commissionBps: 20_000 })
          .where(eq(platformSettings.id, "default"));
        throw new Rollback();
      })
      .catch((error) => {
        if (!(error instanceof Rollback)) throw error;
      });
  } catch {
    rejected = true;
  }
  check("a rate above 100% is refused by the database", rejected);

  let secondRow = false;
  try {
    await db
      .transaction(async (tx) => {
        await tx.insert(platformSettings).values({ id: "other" });
        throw new Rollback();
      })
      .catch((error) => {
        if (!(error instanceof Rollback)) throw error;
      });
  } catch {
    secondRow = true;
  }
  check("a second settings row is refused", secondRow);

  const restored = await db
    .select({ bps: platformSettings.commissionBps })
    .from(platformSettings)
    .where(eq(platformSettings.id, "default"));
  check(
    "the live rate is unchanged after the checks",
    restored[0].bps === original.commissionBps,
    `${restored[0].bps} bps`,
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
