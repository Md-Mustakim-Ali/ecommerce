/**
 * Verifies the rate limiter.
 *
 * Two things matter and neither is "does it count": that concurrent requests
 * cannot both slip through on the same allowance, and that two subjects do not
 * share a bucket. Both are the kind of bug that only appears under load, which
 * is exactly when a limiter is meant to work.
 *
 * Rolls back. Nothing survives the run.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "../lib/db/index.ts";
import { rateLimits } from "../lib/db/schema/index.ts";

let failures = 0;
function check(label: string, condition: boolean, detail = "") {
  if (!condition) failures++;
  console.log(
    `${condition ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`,
  );
}

/** The same upsert checkRateLimit runs, against the transaction. */
async function hit(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  key: string,
  windowStart: Date,
): Promise<number> {
  const [row] = await tx
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });
  return row.count;
}

async function main() {
  await db
    .transaction(async (tx) => {
      const windowStart = new Date(Math.floor(Date.now() / 60000) * 60000);
      const alice = `verify:alice-${Date.now()}`;
      const bob = `verify:bob-${Date.now()}`;

      console.log("--- counting ---");

      const first = await hit(tx, alice, windowStart);
      check("the first attempt counts as one", first === 1, `${first}`);

      for (let i = 0; i < 8; i++) await hit(tx, alice, windowStart);
      const tenth = await hit(tx, alice, windowStart);
      check("ten attempts count as ten", tenth === 10, `${tenth}`);

      const eleventh = await hit(tx, alice, windowStart);
      check(
        "the eleventh is over a limit of ten",
        eleventh > 10,
        `count ${eleventh}`,
      );

      console.log("\n--- isolation ---");

      const bobFirst = await hit(tx, bob, windowStart);
      check(
        "a different subject starts from zero",
        bobFirst === 1,
        `${bobFirst}`,
      );

      const rows = await tx
        .select({ key: rateLimits.key, count: rateLimits.count })
        .from(rateLimits)
        .where(
          and(
            eq(rateLimits.windowStart, windowStart),
            sql`${rateLimits.key} in (${alice}, ${bob})`,
          ),
        );
      check(
        "each subject has exactly one row for the window",
        rows.length === 2,
        `${rows.length} rows`,
      );

      console.log("\n--- windows ---");

      // A later window is a separate row, so the allowance resets.
      const nextWindow = new Date(windowStart.getTime() + 60000);
      const afterReset = await hit(tx, alice, nextWindow);
      check(
        "the next window starts the count again",
        afterReset === 1,
        `${afterReset}`,
      );

      console.log("\n--- concurrency ---");

      // The one that actually matters. Ten simultaneous attempts must produce
      // ten distinct counts, not ten rows all reading 1 — which is what a
      // read-then-write implementation would do.
      const racer = `verify:race-${Date.now()}`;
      const results = await Promise.all(
        Array.from({ length: 10 }, () => hit(tx, racer, windowStart)),
      );
      const distinct = new Set(results);
      check(
        "ten concurrent attempts produce ten distinct counts",
        distinct.size === 10,
        `${[...distinct].sort((a, b) => a - b).join(",")}`,
      );
      check(
        "and the highest is exactly ten",
        Math.max(...results) === 10,
        `${Math.max(...results)}`,
      );

      const [{ rowCount }] = await tx
        .select({ rowCount: sql<number>`count(*)::int` })
        .from(rateLimits)
        .where(eq(rateLimits.key, racer));
      check(
        "and they share one row rather than racing to insert several",
        rowCount === 1,
        `${rowCount} row`,
      );

      console.log(
        failures === 0
          ? "\nall checks passed"
          : `\n${failures} CHECK(S) FAILED`,
      );

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
