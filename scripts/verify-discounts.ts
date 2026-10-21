/**
 * Exercises discount codes against the real database.
 *
 * The pure rules are unit-tested; this checks the parts that only exist once
 * rows are involved — the case-insensitive lookup, the store scoping against
 * real store ids, and the conditional increment that stops two checkouts
 * claiming the last use of a limited code.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "../lib/db/index.ts";
import { discountCodes, stores } from "../lib/db/schema/index.ts";
import { applyDiscount, normaliseCode } from "../lib/discounts/apply.ts";

let failures = 0;
function check(label: string, condition: boolean, detail = "") {
  if (!condition) failures++;
  console.log(
    `${condition ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`,
  );
}
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

async function load(code: string) {
  const [row] = await db
    .select()
    .from(discountCodes)
    .where(sql`upper(${discountCodes.code}) = ${normaliseCode(code)}`)
    .limit(1);
  return row ?? null;
}

function definition(row: NonNullable<Awaited<ReturnType<typeof load>>>) {
  return {
    id: row.id,
    code: row.code,
    scope: row.scope,
    storeId: row.storeId,
    kind: row.kind,
    value: row.value,
    maxDiscountCents: row.maxDiscountCents,
    minSubtotalCents: row.minSubtotalCents,
    maxRedemptions: row.maxRedemptions,
    redemptionCount: row.redemptionCount,
    perCustomerLimit: row.perCustomerLimit,
    status: row.status,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
  };
}

async function main() {
  const storeRows = await db
    .select({ id: stores.id, name: stores.name, slug: stores.slug })
    .from(stores)
    .orderBy(stores.createdAt)
    .limit(2);

  const [northmark, other] = storeRows;

  // A cart straddling two sellers, which is the case store scoping exists for.
  const cart = [
    { id: "l1", storeId: northmark.id, lineTotalCents: 6000 },
    { id: "l2", storeId: northmark.id, lineTotalCents: 3000 },
    { id: "l3", storeId: other.id, lineTotalCents: 1000 },
  ];
  const cartTotal = cart.reduce((s, l) => s + l.lineTotalCents, 0);
  console.log(
    `cart ${money(cartTotal)} across ${northmark.name} and ${other.name}\n`,
  );

  console.log("--- lookup ---");
  check("lower-case input finds the code", (await load("save10")) !== null);
  check("mixed case finds it too", (await load("SaVe10")) !== null);
  check("padding is trimmed", (await load("  save10  ")) !== null);
  check("an unknown code is not found", (await load("NOPE123")) === null);

  console.log("\n--- platform code ---");
  const save10 = await load("SAVE10");
  if (!save10) throw new Error("SAVE10 not seeded");

  const platform = applyDiscount({
    discount: definition(save10),
    lines: cart,
    shippingCents: 599,
    customerRedemptions: 0,
  });
  check("applies", platform.ok);
  if (platform.ok) {
    check(
      "takes 10% of the whole cart",
      platform.amountCents === 1000,
      money(platform.amountCents),
    );
    check(
      "touches both sellers",
      Object.keys(platform.perStore).length === 2,
      Object.entries(platform.perStore)
        .map(([id, v]) => `${id === northmark.id ? "NM" : "OT"} ${money(v)}`)
        .join(", "),
    );
    check(
      "allocation sums exactly",
      platform.perLine.reduce((s, l) => s + l.amountCents, 0) ===
        platform.amountCents,
    );
  }

  console.log("\n--- store code ---");
  const storeCode = await load("NORTHMARK15");
  if (!storeCode) throw new Error("NORTHMARK15 not seeded");
  check(
    "is scoped to a real store",
    storeCode.storeId === northmark.id,
    storeCode.storeId ?? "null",
  );

  const scoped = applyDiscount({
    discount: definition(storeCode),
    lines: cart,
    shippingCents: 599,
    customerRedemptions: 0,
  });
  check("applies", scoped.ok);
  if (scoped.ok) {
    // 15% of the 9,000 at Northmark, not of the 10,000 cart.
    check(
      "discounts only that store's lines",
      scoped.amountCents === 1350,
      `${money(scoped.amountCents)} (15% of ${money(9000)})`,
    );
    check(
      "the other seller pays nothing",
      scoped.perStore[other.id] === undefined,
    );
    check(
      "no line from the other store is touched",
      scoped.perLine.every((l) => l.storeId === northmark.id),
    );
  }

  console.log("\n--- caps and windows ---");
  const expired = await load("EXPIRED");
  if (expired) {
    const result = applyDiscount({
      discount: definition(expired),
      lines: cart,
      shippingCents: 599,
      customerRedemptions: 0,
    });
    check(
      "an expired code is refused",
      !result.ok && result.reason === "expired",
    );
  }

  const freeship = await load("FREESHIP");
  if (freeship) {
    const below = applyDiscount({
      discount: definition(freeship),
      lines: [{ id: "x", storeId: northmark.id, lineTotalCents: 1000 }],
      shippingCents: 599,
      customerRedemptions: 0,
    });
    check(
      "free shipping is refused below its minimum",
      !below.ok && below.reason === "below-minimum",
      `$10 cart vs ${money(freeship.minSubtotalCents)} minimum`,
    );

    const above = applyDiscount({
      discount: definition(freeship),
      lines: cart,
      shippingCents: 599,
      customerRedemptions: 0,
    });
    check("and applies above it", above.ok);
    if (above.ok) {
      check("takes shipping to zero", above.shippingDiscountCents === 599);
      check("and nothing off the items", above.amountCents === 0);
    }
  }

  // The cap on NORTHMARK15 is $50; 15% of a large enough cart would exceed it.
  const bigCart = [
    { id: "b1", storeId: northmark.id, lineTotalCents: 100_000 },
  ];
  const capped = applyDiscount({
    discount: definition(storeCode),
    lines: bigCart,
    shippingCents: 0,
    customerRedemptions: 0,
  });
  if (capped.ok) {
    check(
      "the cap holds on a large cart",
      capped.amountCents === 5000,
      `${money(capped.amountCents)} rather than ${money(15_000)}`,
    );
  }

  console.log("\n--- the redemption race ---");
  // Two checkouts both see the last use available; the conditional update is
  // what decides between them.
  const [limited] = await db
    .insert(discountCodes)
    .values({
      code: `RACE-${Date.now()}`,
      scope: "platform",
      kind: "fixed_amount",
      value: 500,
      maxRedemptions: 1,
      status: "published",
    })
    .returning({ id: discountCodes.id, code: discountCodes.code });

  const claim = () =>
    db
      .update(discountCodes)
      .set({ redemptionCount: sql`${discountCodes.redemptionCount} + 1` })
      .where(
        sql`${discountCodes.id} = ${limited.id}
            and (${discountCodes.maxRedemptions} is null
                 or ${discountCodes.redemptionCount} < ${discountCodes.maxRedemptions})`,
      )
      .returning({ id: discountCodes.id });

  const [first, second] = await Promise.all([claim(), claim()]);
  const winners = [first, second].filter((r) => r.length > 0).length;
  check(
    "only one of two racing claims succeeds",
    winners === 1,
    `${winners} winner(s)`,
  );

  const [after] = await db
    .select({ count: discountCodes.redemptionCount })
    .from(discountCodes)
    .where(eq(discountCodes.id, limited.id));
  check("the counter lands on exactly 1", after.count === 1, `${after.count}`);

  await db.delete(discountCodes).where(eq(discountCodes.id, limited.id));

  console.log(
    failures === 0 ? "\nall checks passed" : `\n${failures} CHECK(S) FAILED`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
