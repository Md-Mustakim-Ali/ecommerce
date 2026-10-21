import { eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { auditLog, brands, products, productTags, tags } from "@/lib/db/schema";
import { refreshSearchKeywords, resolveTerm, type TermKind } from "./terms";

const TABLES = { brand: brands, tag: tags } as const;

type Actor = { id: string; email: string };

export async function approveTerm(
  db: Db,
  kind: TermKind,
  id: string,
  actor: Actor,
) {
  const table = TABLES[kind];

  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(table).where(eq(table.id, id));
    if (!before) throw new Error(`${kind} ${id} not found`);
    if (before.status === "merged") {
      throw new Error(`${kind} ${id} is merged; approve its survivor instead`);
    }

    const [after] = await tx
      .update(table)
      .set({
        status: "approved",
        approvedBy: actor.id,
        approvedAt: new Date(),
        rejectionReason: null,
      })
      .where(eq(table.id, id))
      .returning();

    await tx.insert(auditLog).values({
      actorId: actor.id,
      actorEmail: actor.email,
      action: `${kind}.approve`,
      targetType: kind,
      targetId: id,
      targetLabel: before.name,
      before: { status: before.status },
      after: { status: after.status },
    });

    return after;
  });
}

export async function rejectTerm(
  db: Db,
  kind: TermKind,
  id: string,
  actor: Actor,
  reason: string,
) {
  const table = TABLES[kind];

  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(table).where(eq(table.id, id));
    if (!before) throw new Error(`${kind} ${id} not found`);

    const [after] = await tx
      .update(table)
      .set({
        status: "rejected",
        rejectionReason: reason,
        approvedBy: actor.id,
      })
      .where(eq(table.id, id))
      .returning();

    await tx.insert(auditLog).values({
      actorId: actor.id,
      actorEmail: actor.email,
      action: `${kind}.reject`,
      targetType: kind,
      targetId: id,
      targetLabel: before.name,
      before: { status: before.status },
      after: { status: after.status, reason },
    });

    return after;
  });
}

export type MergeResult = {
  movedProducts: number;
  survivorId: string;
};

/**
 * Merges `loserId` into `survivorId`.
 *
 * The loser is never deleted. It keeps a pointer at the survivor so any product
 * or bookmark still referencing it resolves, and so the merge itself stays in
 * the audit trail. Deleting it would break exactly the references the merge is
 * supposed to repair.
 *
 * Chains are flattened: merging into a term that is itself merged repoints at
 * the ultimate survivor, so resolution stays a single hop.
 */
export async function mergeTerms(
  db: Db,
  kind: TermKind,
  loserId: string,
  survivorId: string,
  actor: Actor,
): Promise<MergeResult> {
  if (loserId === survivorId) {
    throw new Error("Cannot merge a term into itself");
  }

  const table = TABLES[kind];

  // Resolve outside the transaction: if the target is itself merged, the real
  // survivor is what everything should point at.
  const resolvedSurvivor = await resolveTerm(db, kind, survivorId);
  if (!resolvedSurvivor) {
    throw new Error(
      `Survivor ${survivorId} not found or its merge chain is broken`,
    );
  }
  if (resolvedSurvivor.id === loserId) {
    // Following the survivor's chain landed back on the loser. Completing the
    // merge would create a cycle that resolveTerm could never escape.
    throw new Error("Refusing to merge: this would create a merge cycle");
  }
  if (resolvedSurvivor.status !== "approved") {
    throw new Error("Can only merge into an approved term");
  }

  return db.transaction(async (tx) => {
    const [loser] = await tx.select().from(table).where(eq(table.id, loserId));
    if (!loser) throw new Error(`${kind} ${loserId} not found`);
    if (loser.status === "merged") {
      throw new Error(`${kind} ${loserId} is already merged`);
    }

    let affectedProductIds: string[] = [];

    if (kind === "brand") {
      const moved = await tx
        .update(products)
        .set({ brandId: resolvedSurvivor.id })
        .where(eq(products.brandId, loserId))
        .returning({ id: products.id });
      affectedProductIds = moved.map((r) => r.id);
    } else {
      const rows = await tx
        .select({ productId: productTags.productId })
        .from(productTags)
        .where(eq(productTags.tagId, loserId));
      affectedProductIds = rows.map((r) => r.productId);

      // A product may already carry the survivor tag, and (product_id, tag_id)
      // is the primary key — so insert-and-ignore, then drop the loser rows,
      // rather than updating in place and hitting a conflict.
      if (affectedProductIds.length > 0) {
        await tx
          .insert(productTags)
          .values(
            affectedProductIds.map((productId) => ({
              productId,
              tagId: resolvedSurvivor.id,
            })),
          )
          .onConflictDoNothing();

        await tx.delete(productTags).where(eq(productTags.tagId, loserId));
      }
    }

    await tx
      .update(table)
      .set({
        status: "merged",
        mergedIntoId: resolvedSurvivor.id,
        approvedBy: actor.id,
        approvedAt: new Date(),
      })
      .where(eq(table.id, loserId));

    // Anything that previously pointed at the loser now resolves one hop
    // further, so flatten those pointers too and keep resolution at depth 1.
    await tx
      .update(table)
      .set({ mergedIntoId: resolvedSurvivor.id })
      .where(eq(table.mergedIntoId, loserId));

    if (affectedProductIds.length > 0) {
      await refreshSearchKeywordsTx(tx, affectedProductIds);
    }

    await tx.insert(auditLog).values({
      actorId: actor.id,
      actorEmail: actor.email,
      action: `${kind}.merge`,
      targetType: kind,
      targetId: loserId,
      targetLabel: loser.name,
      before: { status: loser.status, name: loser.name },
      after: {
        status: "merged",
        mergedInto: resolvedSurvivor.id,
        mergedIntoName: resolvedSurvivor.name,
        movedProducts: affectedProductIds.length,
      },
    });

    return {
      movedProducts: affectedProductIds.length,
      survivorId: resolvedSurvivor.id,
    };
  });
}

/** Same as refreshSearchKeywords, bound to an open transaction. */
async function refreshSearchKeywordsTx(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  productIds: string[],
) {
  await tx.execute(sql`
    update ${products} p
    set search_keywords = coalesce(k.keywords, '')
    from (
      select
        p2.id,
        concat_ws(' ',
          b.name,
          (select string_agg(t.name, ' ')
             from ${productTags} pt
             join ${tags} t on t.id = pt.tag_id
            where pt.product_id = p2.id)
        ) as keywords
      from ${products} p2
      left join ${brands} b on b.id = p2.brand_id
      where p2.id in ${productIds}
    ) k
    where p.id = k.id
  `);
}

export { refreshSearchKeywords };
