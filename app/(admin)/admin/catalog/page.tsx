import { asc, desc, eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPlatformAccess } from "@/lib/auth/access";
import { db } from "@/lib/db";
import { brands, products, tags } from "@/lib/db/schema";
import { ReviewQueue } from "./review-queue";

export const metadata: Metadata = { title: "Catalog review" };

/** Near-matches among approved terms, computed per pending row. */
async function pendingWithSuggestions(kind: "brand" | "tag") {
  const table = kind === "brand" ? brands : tags;

  const pending = await db
    .select({
      id: table.id,
      name: table.name,
      slug: table.slug,
      createdAt: table.createdAt,
    })
    .from(table)
    .where(eq(table.status, "pending"))
    .orderBy(asc(table.createdAt));

  // Each pending term carries its own merge candidates, so the reviewer never
  // has to go looking for the thing it is probably a duplicate of.
  return Promise.all(
    pending.map(async (row) => {
      const candidates = await db
        .select({
          id: table.id,
          name: table.name,
          score: sql<number>`similarity(${table.name}, ${row.name})`,
        })
        .from(table)
        .where(
          sql`${table.status} = 'approved' and similarity(${table.name}, ${row.name}) > 0.25`,
        )
        .orderBy(desc(sql`similarity(${table.name}, ${row.name})`))
        .limit(5);

      const usage =
        kind === "brand"
          ? (
              await db
                .select({ n: sql<number>`count(*)::int` })
                .from(products)
                .where(eq(products.brandId, row.id))
            )[0].n
          : (
              await db
                .select({ n: sql<number>`count(*)::int` })
                .from(sql`product_tags`)
                .where(sql`tag_id = ${row.id}`)
            )[0].n;

      return { ...row, candidates, usage };
    }),
  );
}

export default async function CatalogReviewPage() {
  const access = await getPlatformAccess();
  if (!access) notFound();

  const canReviewBrands = access.permissions.has("platform.brand.review");
  const canReviewTags = access.permissions.has("platform.tag.review");
  if (!canReviewBrands && !canReviewTags) notFound();

  const [pendingBrands, pendingTags] = await Promise.all([
    canReviewBrands ? pendingWithSuggestions("brand") : Promise.resolve([]),
    canReviewTags ? pendingWithSuggestions("tag") : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="font-semibold text-xl">Catalog review</h1>
        <p className="text-secondary-text text-sm">
          Approve what is genuinely new. Merge what is a duplicate — merging
          moves the products across and keeps old links working.
        </p>
      </div>

      {canReviewBrands ? (
        <ReviewQueue kind="brand" items={pendingBrands} />
      ) : null}
      {canReviewTags ? <ReviewQueue kind="tag" items={pendingTags} /> : null}
    </div>
  );
}
