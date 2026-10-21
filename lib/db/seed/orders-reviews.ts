import { eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import {
  ledgerEntries,
  orderItems,
  orders,
  products,
  productVariants,
  reviews,
  subOrders,
} from "@/lib/db/schema";
import { buildOrderTotals } from "@/lib/money/order-math";

/**
 * A year of orders, with reviews on the delivered ones.
 *
 * Analytics is the reason this exists. A dashboard built against three orders
 * tells you nothing about whether the dashboard works — trends, seasonality,
 * forecast intervals and concentration measures all need enough history to
 * have a shape, and a rating filter with no reviews behind it silently returns
 * nothing.
 *
 * The generated demand is deliberately not uniform:
 *
 *   - a gentle upward trend, so a forecast has something to find
 *   - day-of-week seasonality, because retail has it and a model that ignores
 *     it produces intervals that are far too narrow
 *   - a December lift
 *   - a heavy-tailed spread across products, so concentration measures show
 *     the real 80/20 rather than a flat line
 *
 * Every order is written through the same money path the application uses,
 * so the seeded ledger reconciles under exactly the checks that guard
 * production data.
 */

/** Deterministic PRNG (mulberry32). A fixed seed means a reproducible dataset. */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller, for demand noise that is normal rather than uniform. */
function gaussian(random: () => number): number {
  const u = Math.max(random(), Number.EPSILON);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const DAY_OF_WEEK_FACTOR = [0.78, 1.02, 1.06, 1.04, 1.12, 1.24, 0.94];

/** Expected orders on a given day, before noise. */
function expectedVolume(dayIndex: number, total: number, date: Date): number {
  // Linear growth from 60% to 140% of the base rate across the window.
  const trend = 0.6 + (0.8 * dayIndex) / total;
  const dow = DAY_OF_WEEK_FACTOR[date.getDay()];
  // A visible seasonal bump, so decomposition has something to decompose.
  const december = date.getMonth() === 11 ? 1.45 : 1;
  return trend * dow * december;
}

export async function seedOrdersAndReviews(
  db: Db,
  input: {
    buyerIds: string[];
    /** How far back to generate. */
    days?: number;
    /** Base orders per day before trend and seasonality. */
    ordersPerDay?: number;
    seed?: number;
  },
) {
  const days = input.days ?? 365;
  const base = input.ordersPerDay ?? 3.2;
  const random = makeRandom(input.seed ?? 20260903);

  // Live, purchasable variants only. An order against a draft or archived
  // product would be invisible on the storefront and make the analytics
  // disagree with it.
  const catalogue = await db
    .select({
      variantId: productVariants.id,
      productId: products.id,
      storeId: products.storeId,
      title: products.title,
      priceCents: productVariants.priceCents,
      sku: productVariants.sku,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(sql`${products.status} = 'active' and ${productVariants.stock} > 0`);

  if (catalogue.length === 0 || input.buyerIds.length === 0) {
    return { orders: 0, items: 0, reviews: 0 };
  }

  // A heavy tail: a few products sell a lot, most sell a little. Zipf-ish
  // weights, so concentration measures have something real to measure.
  const ranked = [...catalogue].sort(() => random() - 0.5);
  const weights = ranked.map((_, index) => 1 / (index + 1) ** 0.75);
  const weightTotal = weights.reduce((sum, w) => sum + w, 0);
  const cumulative: number[] = [];
  let running = 0;
  for (const weight of weights) {
    running += weight / weightTotal;
    cumulative.push(running);
  }

  function pickVariant() {
    const roll = random();
    let low = 0;
    let high = cumulative.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (cumulative[mid] < roll) low = mid + 1;
      else high = mid;
    }
    return ranked[low];
  }

  const now = new Date();
  let orderSequence = 1000;

  const orderRows: (typeof orders.$inferInsert)[] = [];
  const subOrderRows: (typeof subOrders.$inferInsert)[] = [];
  const itemRows: (typeof orderItems.$inferInsert)[] = [];
  const ledgerRows: (typeof ledgerEntries.$inferInsert)[] = [];
  // Collected so reviews can be attached after the items have ids.
  const reviewSeeds: {
    orderItemId: string;
    productId: string;
    buyerId: string;
    placedAt: Date;
  }[] = [];

  for (let dayIndex = 0; dayIndex < days; dayIndex++) {
    const date = new Date(now);
    date.setDate(date.getDate() - (days - dayIndex));
    date.setHours(
      9 + Math.floor(random() * 11),
      Math.floor(random() * 60),
      0,
      0,
    );

    const lambda = base * expectedVolume(dayIndex, days, date);
    const count = Math.max(
      0,
      Math.round(lambda + gaussian(random) * Math.sqrt(lambda)),
    );

    for (let n = 0; n < count; n++) {
      const buyerId =
        input.buyerIds[Math.floor(random() * input.buyerIds.length)];

      // Most carts are one line; a long tail are larger.
      const lineCount = random() < 0.72 ? 1 : random() < 0.85 ? 2 : 3;
      const chosen = new Map<string, (typeof catalogue)[number]>();
      for (let i = 0; i < lineCount; i++) {
        const variant = pickVariant();
        chosen.set(variant.variantId, variant);
      }

      const lines = [...chosen.values()].map((variant) => ({
        variantId: variant.variantId,
        storeId: variant.storeId,
        unitPriceCents: variant.priceCents,
        quantity: random() < 0.82 ? 1 : random() < 0.94 ? 2 : 3,
      }));

      const shippingCents =
        lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0) >= 7500
          ? 0
          : 599;

      // The application's own money path, so the seeded ledger reconciles
      // under exactly the invariants that guard real orders.
      const totals = buildOrderTotals({ lines, shippingCents });

      const placedAt = new Date(date.getTime() + n * 61_000);
      const orderId = crypto.randomUUID();
      orderSequence += 1;
      const orderNumber = `ORD-${placedAt.getFullYear()}-${String(orderSequence).padStart(6, "0")}`;

      // Age decides how far through fulfilment an order has got. Recent ones
      // are still moving; old ones have landed.
      const ageDays = (now.getTime() - placedAt.getTime()) / 86_400_000;
      const roll = random();
      const outcome =
        ageDays > 10
          ? roll < 0.04
            ? "cancelled"
            : roll < 0.06
              ? "refunded"
              : "delivered"
          : ageDays > 5
            ? roll < 0.75
              ? "delivered"
              : "shipped"
            : ageDays > 2
              ? roll < 0.5
                ? "shipped"
                : "accepted"
              : roll < 0.35
                ? "accepted"
                : "pending";

      const orderStatus =
        outcome === "cancelled"
          ? "cancelled"
          : outcome === "refunded"
            ? "refunded"
            : outcome === "delivered" || outcome === "shipped"
              ? "fulfilled"
              : "paid";

      orderRows.push({
        id: orderId,
        buyerId,
        orderNumber,
        email: `buyer-${buyerId.slice(0, 6)}@buyer.test`,
        status: orderStatus,
        subtotalCents: totals.subtotalCents,
        shippingCents: totals.shippingCents,
        totalCents: totals.totalCents,
        currency: "USD",
        shippingAddress: {
          recipientName: "Seeded Buyer",
          line1: "12 Example Way",
          city: "Testville",
          postalCode: "12345",
          countryCode: "US",
        },
        placedAt,
        createdAt: placedAt,
      });

      for (const sub of totals.subOrders) {
        const subOrderId = crypto.randomUUID();
        const shippedAt =
          outcome === "shipped" || outcome === "delivered"
            ? new Date(placedAt.getTime() + 86_400_000)
            : null;
        const deliveredAt =
          outcome === "delivered"
            ? new Date(placedAt.getTime() + 3 * 86_400_000)
            : null;

        subOrderRows.push({
          id: subOrderId,
          orderId,
          storeId: sub.storeId,
          status: outcome,
          subtotalCents: sub.subtotalCents,
          shippingCents: sub.shippingCents,
          commissionCents: sub.commissionCents,
          payoutCents: sub.payoutCents,
          trackingCarrier: shippedAt ? "DHL" : null,
          trackingNumber: shippedAt
            ? `JD${Math.floor(random() * 1e12)
                .toString()
                .padStart(12, "0")}`
            : null,
          acceptedAt: placedAt,
          shippedAt,
          deliveredAt,
          createdAt: placedAt,
        });

        for (const line of sub.lines) {
          const variant = chosen.get(line.variantId);
          if (!variant) continue;
          const orderItemId = crypto.randomUUID();

          itemRows.push({
            id: orderItemId,
            subOrderId,
            variantId: line.variantId,
            productTitle: variant.title,
            sku: variant.sku,
            unitPriceCents: line.unitPriceCents,
            quantity: line.quantity,
            lineTotalCents: line.lineTotalCents,
            createdAt: placedAt,
          });

          // Roughly a fifth of delivered purchases get reviewed, which is
          // about what real marketplaces see.
          if (outcome === "delivered" && random() < 0.22) {
            reviewSeeds.push({
              orderItemId,
              productId: variant.productId,
              buyerId,
              placedAt,
            });
          }
        }

        // Cancelled orders never reach the ledger: nothing was earned.
        if (outcome === "cancelled") continue;

        ledgerRows.push({
          storeId: sub.storeId,
          subOrderId,
          type: "sale",
          amountCents: BigInt(sub.subtotalCents + sub.shippingCents),
          currency: "USD",
          description: `Sale on ${orderNumber}`,
          idempotencyKey: `sale:${subOrderId}`,
          createdAt: placedAt,
        });

        if (sub.commissionCents > 0) {
          ledgerRows.push({
            storeId: sub.storeId,
            subOrderId,
            type: "commission",
            amountCents: BigInt(-sub.commissionCents),
            currency: "USD",
            description: `Commission on ${orderNumber}`,
            idempotencyKey: `commission:${subOrderId}`,
            createdAt: placedAt,
          });
        }

        // A refund is a new negative entry, never an edit to the sale.
        if (outcome === "refunded") {
          const gross = sub.subtotalCents + sub.shippingCents;
          ledgerRows.push({
            storeId: sub.storeId,
            subOrderId,
            type: "refund",
            amountCents: BigInt(-gross),
            currency: "USD",
            description: `Refund on ${orderNumber}`,
            idempotencyKey: `refund:${subOrderId}`,
            createdAt: new Date(placedAt.getTime() + 5 * 86_400_000),
          });
          if (sub.commissionCents > 0) {
            ledgerRows.push({
              storeId: sub.storeId,
              subOrderId,
              type: "commission",
              amountCents: BigInt(sub.commissionCents),
              currency: "USD",
              description: `Commission returned on ${orderNumber}`,
              idempotencyKey: `commission-refund:${subOrderId}`,
              createdAt: new Date(placedAt.getTime() + 5 * 86_400_000),
            });
          }
        }
      }
    }
  }

  const chunk = <T>(rows: T[], size: number) => {
    const out: T[][] = [];
    for (let i = 0; i < rows.length; i += size)
      out.push(rows.slice(i, i + size));
    return out;
  };

  for (const batch of chunk(orderRows, 500))
    await db.insert(orders).values(batch);
  for (const batch of chunk(subOrderRows, 500))
    await db.insert(subOrders).values(batch);
  for (const batch of chunk(itemRows, 500))
    await db.insert(orderItems).values(batch);
  for (const batch of chunk(ledgerRows, 500))
    await db.insert(ledgerEntries).values(batch);

  // Ratings skew high, as they do everywhere, but with a real left tail so the
  // histogram and the Bayesian shrinkage both have something to work with.
  const RATING_WEIGHTS: [number, number][] = [
    [5, 0.52],
    [4, 0.26],
    [3, 0.11],
    [2, 0.06],
    [1, 0.05],
  ];
  const HEADLINES: Record<number, string[]> = {
    5: ["Exactly as described", "Would buy again", "Better than expected"],
    4: ["Good, with one caveat", "Solid for the price", "Happy overall"],
    3: ["Fine, not remarkable", "Does the job", "Mixed feelings"],
    2: ["Not what I hoped", "Disappointing finish", "Arrived worn"],
    1: ["Sent it back", "Fell apart quickly", "Not as pictured"],
  };

  const reviewRows = reviewSeeds.map((seed) => {
    const roll = random();
    let acc = 0;
    let rating = 5;
    for (const [value, weight] of RATING_WEIGHTS) {
      acc += weight;
      if (roll <= acc) {
        rating = value;
        break;
      }
    }
    const headlines = HEADLINES[rating];
    return {
      productId: seed.productId,
      buyerId: seed.buyerId,
      orderItemId: seed.orderItemId,
      rating,
      title: headlines[Math.floor(random() * headlines.length)],
      body: null,
      // A few days after delivery, which is when people actually write them.
      createdAt: new Date(seed.placedAt.getTime() + 5 * 86_400_000),
    };
  });

  for (const batch of chunk(reviewRows, 500)) {
    await db.insert(reviews).values(batch).onConflictDoNothing();
  }

  return {
    orders: orderRows.length,
    items: itemRows.length,
    reviews: reviewRows.length,
    ledger: ledgerRows.length,
  };
}
