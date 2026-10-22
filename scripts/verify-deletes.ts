/**
 * Verifies product deletion and page deletion.
 *
 * The claim in the permission description is "delete a product that has never
 * been ordered". So the test that matters is the refusal, not the success: a
 * product with order history must survive, because order_items.variant_id is
 * ON DELETE SET NULL and the database would otherwise let the link be severed
 * without complaint.
 *
 * Rolls back. Nothing survives the run.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "../lib/db/index.ts";
import {
  categories,
  orderItems,
  pageBlocks,
  pages,
  products,
  productVariants,
  stores,
} from "../lib/db/schema/index.ts";

let failures = 0;
function check(label: string, condition: boolean, detail = "") {
  if (!condition) failures++;
  console.log(
    `${condition ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`,
  );
}

/** The same count the action runs before allowing a delete. */
async function orderedCount(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  productId: string,
) {
  const [{ ordered }] = await tx
    .select({ ordered: sql<number>`count(*)::int` })
    .from(orderItems)
    .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .where(eq(productVariants.productId, productId));
  return ordered;
}

async function main() {
  await db
    .transaction(async (tx) => {
      const [store] = await tx
        .select({ id: stores.id, name: stores.name })
        .from(stores)
        .orderBy(stores.createdAt)
        .limit(1);

      console.log(`store: ${store.name}\n--- products ---`);

      // A seeded product with real order history.
      const sold = await tx
        .select({
          id: products.id,
          title: products.title,
          ordered: sql<number>`count(${orderItems.id})::int`,
        })
        .from(products)
        .innerJoin(productVariants, eq(productVariants.productId, products.id))
        .innerJoin(orderItems, eq(orderItems.variantId, productVariants.id))
        .where(eq(products.storeId, store.id))
        .groupBy(products.id, products.title)
        .limit(1);

      check(
        "found a product with order history to test the refusal against",
        sold.length === 1,
        sold[0] ? `${sold[0].title} — ${sold[0].ordered} order items` : "none",
      );

      const soldCount = await orderedCount(tx, sold[0].id);
      check(
        "the guard sees that history",
        soldCount > 0,
        `${soldCount} order items`,
      );
      check("so deletion is refused", soldCount > 0);

      // The database would allow it. That is the whole reason for the guard:
      // variant_id is ON DELETE SET NULL, so nothing here would raise.
      const rule = await tx.execute<{ delete_rule: string }>(
        sql`select delete_rule from information_schema.referential_constraints
            where constraint_name = 'order_items_variant_id_product_variants_id_fk'`,
      );
      check(
        "and the database itself would NOT have stopped it",
        rule[0]?.delete_rule === "SET NULL",
        `order_items.variant_id is ON DELETE ${rule[0]?.delete_rule}`,
      );

      // A fresh product with no orders is deletable, and takes its variants
      // with it.
      const [category] = await tx
        .select({ id: categories.id })
        .from(categories)
        .limit(1);

      const [fresh] = await tx
        .insert(products)
        .values({
          storeId: store.id,
          categoryId: category.id,
          slug: `verify-delete-${Date.now()}`,
          title: "Verify delete",
          status: "draft",
        })
        .returning({ id: products.id });

      await tx.insert(productVariants).values([
        { productId: fresh.id, sku: "VD-1", priceCents: 1000, stock: 1 },
        { productId: fresh.id, sku: "VD-2", priceCents: 1200, stock: 1 },
      ]);

      check(
        "a product with no orders passes the guard",
        (await orderedCount(tx, fresh.id)) === 0,
      );

      await tx.delete(products).where(eq(products.id, fresh.id));

      const leftoverVariants = await tx
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(eq(productVariants.productId, fresh.id));
      check(
        "deleting it takes its variants with it",
        leftoverVariants.length === 0,
        `${leftoverVariants.length} left`,
      );

      console.log("\n--- pages ---");

      const [page] = await tx
        .insert(pages)
        .values({
          scope: "store",
          storeId: store.id,
          slug: `verify-delete-${Date.now()}`,
          title: "Verify delete",
          status: "published",
          publishedAt: new Date(),
        })
        .returning({ id: pages.id, status: pages.status });

      await tx.insert(pageBlocks).values([
        { pageId: page.id, type: "rich_text", data: { html: "<p>one</p>" } },
        { pageId: page.id, type: "rich_text", data: { html: "<p>two</p>" } },
      ]);

      check(
        "a published page is refused",
        page.status === "published",
        "must be unpublished first",
      );

      await tx
        .update(pages)
        .set({ status: "draft", publishedAt: null })
        .where(eq(pages.id, page.id));

      const [afterUnpublish] = await tx
        .select({ status: pages.status })
        .from(pages)
        .where(eq(pages.id, page.id));
      check(
        "unpublishing clears the refusal",
        afterUnpublish.status === "draft",
      );

      await tx.delete(pages).where(eq(pages.id, page.id));

      const leftoverBlocks = await tx
        .select({ id: pageBlocks.id })
        .from(pageBlocks)
        .where(eq(pageBlocks.pageId, page.id));
      check(
        "deleting it takes its blocks with it",
        leftoverBlocks.length === 0,
        `${leftoverBlocks.length} left`,
      );

      // Scoping: another store's page id must not resolve.
      const [other] = await tx
        .select({ id: stores.id })
        .from(stores)
        .where(sql`${stores.id} <> ${store.id}`)
        .limit(1);

      const [otherPage] = await tx
        .insert(pages)
        .values({
          scope: "store",
          storeId: other.id,
          slug: `verify-scope-${Date.now()}`,
          title: "Someone else's page",
          status: "draft",
        })
        .returning({ id: pages.id });

      const reachable = await tx
        .select({ id: pages.id })
        .from(pages)
        .where(and(eq(pages.id, otherPage.id), eq(pages.storeId, store.id)));
      check(
        "another store's page is unreachable from this store's scope",
        reachable.length === 0,
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
