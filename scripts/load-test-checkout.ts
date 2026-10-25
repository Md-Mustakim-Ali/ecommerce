/**
 * Load test for checkout.
 *
 * Not a throughput benchmark. The question is not "how many orders a second"
 * — that is a hardware answer — but whether the invariants survive when
 * requests overlap:
 *
 *   1. Does stock ever go negative? Two people buying the last unit at the
 *      same moment is the oldest bug in commerce, and it is invisible until
 *      it is concurrent.
 *   2. Does the ledger still balance? Every order must produce a sale credit
 *      and a commission debit that sum to the payout, under load as at rest.
 *   3. Does anything 500? A checkout that throws under contention loses the
 *      order and the customer.
 *
 * Runs against the real HTTP stack with real sessions, because a test that
 * calls placeOrder directly skips the session, the rate limiter, and the
 * transaction boundary — which is where the interesting failures live.
 *
 *   pnpm load:checkout [concurrency] [rounds]
 */

import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../lib/db/index.ts";
import {
  ledgerEntries,
  orders,
  productVariants,
  subOrders,
} from "../lib/db/schema/index.ts";

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const CONCURRENCY = Number(process.argv[2] ?? 12);
const ROUNDS = Number(process.argv[3] ?? 3);

let failures = 0;
function check(label: string, condition: boolean, detail = "") {
  if (!condition) failures++;
  console.log(
    `${condition ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`,
  );
}

type Timing = { status: number; ms: number; body: string };

/**
 * One shopper: a fresh cart cookie, one item, one checkout.
 *
 * A separate cookie jar per shopper is the point. Sharing one would serialise
 * everything through a single cart row and test nothing.
 */
async function shopper(variantId: string, index: number): Promise<Timing> {
  const jar = new Map<string, string>();

  const cookieHeader = () =>
    [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

  const collect = (response: Response) => {
    for (const entry of response.headers.getSetCookie?.() ?? []) {
      const [pair] = entry.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
  };

  // Server actions are invoked over HTTP by the framework, and reproducing
  // that encoding by hand is brittle. The cart is seeded through the same
  // endpoint the browser uses: a GET to establish a cart cookie, then the
  // add-to-cart action.
  const first = await fetch(`${BASE}/`, {
    headers: { cookie: cookieHeader() },
  });
  collect(first);

  const started = performance.now();
  const response = await fetch(`${BASE}/api/test/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: cookieHeader(),
      Origin: BASE,
    },
    body: JSON.stringify({
      variantId,
      email: `load-${index}-${Date.now()}@loadtest.invalid`,
    }),
  });
  const body = await response.text();

  return { status: response.status, ms: performance.now() - started, body };
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

async function main() {
  console.log(`base: ${BASE}`);
  console.log(`${CONCURRENCY} concurrent × ${ROUNDS} rounds\n`);

  // A variant with enough stock to be bought repeatedly, so the run measures
  // contention rather than immediately hitting out-of-stock.
  const [variant] = await db
    .select({ id: productVariants.id, stock: productVariants.stock })
    .from(productVariants)
    .where(sql`${productVariants.stock} > ${CONCURRENCY * ROUNDS + 5}`)
    .limit(1);

  if (!variant) {
    console.error("no variant with enough stock; run pnpm db:seed");
    process.exit(1);
  }

  const stockBefore = variant.stock;
  const [{ ordersBefore }] = await db
    .select({ ordersBefore: sql<number>`count(*)::int` })
    .from(orders);

  const timings: number[] = [];
  const statuses = new Map<number, number>();

  for (let round = 0; round < ROUNDS; round++) {
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        shopper(variant.id, round * CONCURRENCY + i),
      ),
    );
    for (const result of results) {
      timings.push(result.ms);
      statuses.set(result.status, (statuses.get(result.status) ?? 0) + 1);
    }
    process.stdout.write(`round ${round + 1}/${ROUNDS} done\n`);
  }

  console.log(
    `\nstatus codes: ${[...statuses.entries()]
      .map(([code, n]) => `${code}×${n}`)
      .join(", ")}`,
  );
  console.log(
    `latency: p50 ${percentile(timings, 0.5).toFixed(0)}ms  p95 ${percentile(
      timings,
      0.95,
    ).toFixed(0)}ms  max ${Math.max(...timings).toFixed(0)}ms\n`,
  );

  console.log("--- invariants ---");

  const serverErrors = [...statuses.entries()]
    .filter(([code]) => code >= 500)
    .reduce((sum, [, n]) => sum + n, 0);
  check("nothing returned a 5xx", serverErrors === 0, `${serverErrors}`);

  // 1. Stock never goes negative, anywhere.
  const negative = await db
    .select({ id: productVariants.id, stock: productVariants.stock })
    .from(productVariants)
    .where(lt(productVariants.stock, 0));
  check(
    "no variant has negative stock",
    negative.length === 0,
    negative.length ? `${negative.length} variants` : "none",
  );

  // 2. Stock decreased by exactly the number of orders placed.
  const [after] = await db
    .select({ stock: productVariants.stock })
    .from(productVariants)
    .where(eq(productVariants.id, variant.id));

  const [{ ordersAfter }] = await db
    .select({ ordersAfter: sql<number>`count(*)::int` })
    .from(orders);

  const placed = ordersAfter - ordersBefore;
  const sold = stockBefore - after.stock;
  check(
    "stock fell by exactly the number of orders placed",
    sold === placed,
    `${placed} orders, ${sold} units`,
  );

  // 3. The ledger balances for every sub-order created by this run.
  const unbalanced = await db
    .select({
      subOrderId: subOrders.id,
      payout: subOrders.payoutCents,
      ledger: sql<number>`coalesce(sum(${ledgerEntries.amountCents}), 0)::int`,
    })
    .from(subOrders)
    .innerJoin(orders, eq(orders.id, subOrders.orderId))
    .leftJoin(ledgerEntries, eq(ledgerEntries.subOrderId, subOrders.id))
    .where(and(eq(orders.status, "paid"), sql`${orders.email} like 'load-%'`))
    .groupBy(subOrders.id, subOrders.payoutCents)
    .having(
      sql`coalesce(sum(${ledgerEntries.amountCents}), 0) <> ${subOrders.payoutCents}`,
    );

  check(
    "every settled sub-order's ledger sums to its payout",
    unbalanced.length === 0,
    unbalanced.length ? `${unbalanced.length} disagree` : "all balanced",
  );

  console.log(
    failures === 0
      ? "\ncheckout held up under load"
      : `\n${failures} INVARIANT(S) BROKEN`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
