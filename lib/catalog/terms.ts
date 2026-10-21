import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { brands, products, productTags, tags } from "@/lib/db/schema";
import { prepareCatalogTerm } from "./normalize";

/**
 * Brands and tags are structurally identical: platform-level, deduplicated by
 * a normalised slug, proposed by sellers and reviewed by admins. One
 * implementation parameterised by kind, rather than two that drift.
 */
export type TermKind = "brand" | "tag";

const TABLES = { brand: brands, tag: tags } as const;

export type Term = {
  id: string;
  name: string;
  slug: string;
  status: "pending" | "approved" | "rejected" | "merged";
  mergedIntoId: string | null;
};

export type SimilarTerm = Term & { score: number };

/**
 * Similarity floor for the near-match warning.
 *
 * 0.3 is deliberately loose. A false positive costs a seller one glance at a
 * suggestion; a false negative costs the catalog a permanent duplicate that
 * someone has to find and merge later.
 */
const SIMILARITY_THRESHOLD = 0.3;

/** Typeahead for the seller's search-first flow. Approved terms only. */
export async function searchApprovedTerms(
  db: Db,
  kind: TermKind,
  query: string,
  limit = 10,
): Promise<Term[]> {
  const table = TABLES[kind];
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  // Prefix match first, then trigram similarity, so typing "sam" surfaces
  // "Samsung" ahead of a fuzzy match on something unrelated.
  return db
    .select({
      id: table.id,
      name: table.name,
      slug: table.slug,
      status: table.status,
      mergedIntoId: table.mergedIntoId,
    })
    .from(table)
    .where(
      and(
        eq(table.status, "approved"),
        sql`(${table.name} ILIKE ${`${trimmed}%`} OR similarity(${table.name}, ${trimmed}) > ${SIMILARITY_THRESHOLD})`,
      ),
    )
    .orderBy(
      desc(sql`(${table.name} ILIKE ${`${trimmed}%`})::int`),
      desc(sql`similarity(${table.name}, ${trimmed})`),
    )
    .limit(limit) as Promise<Term[]>;
}

/**
 * Near-matches shown before a seller submits a new term.
 *
 * A unique slug stops "Samsung" being created twice. Only similarity stops
 * "Samsng" and "Samsung Electronics" becoming separate brands, which is what
 * actually happens within a month without this step.
 *
 * Includes pending terms: two sellers proposing the same brand on the same day
 * should see each other's submission rather than both being queued.
 */
export async function findSimilarTerms(
  db: Db,
  kind: TermKind,
  name: string,
  limit = 5,
): Promise<SimilarTerm[]> {
  const table = TABLES[kind];
  const prepared = prepareCatalogTerm(name);
  if (!prepared.ok) return [];

  return db
    .select({
      id: table.id,
      name: table.name,
      slug: table.slug,
      status: table.status,
      mergedIntoId: table.mergedIntoId,
      score: sql<number>`similarity(${table.name}, ${prepared.name})`,
    })
    .from(table)
    .where(
      and(
        inArray(table.status, ["approved", "pending"]),
        sql`similarity(${table.name}, ${prepared.name}) > ${SIMILARITY_THRESHOLD}`,
      ),
    )
    .orderBy(desc(sql`similarity(${table.name}, ${prepared.name})`))
    .limit(limit) as Promise<SimilarTerm[]>;
}

export type ProposeResult =
  | { outcome: "created"; term: Term }
  /** An approved or pending term with this slug already existed. */
  | { outcome: "existing"; term: Term }
  /** The slug pointed at a merged term; the survivor is returned instead. */
  | { outcome: "resolved"; term: Term }
  | { outcome: "rejected-previously"; term: Term }
  | { outcome: "invalid"; reason: "empty" | "too-long" | "no-alphanumeric" };

/**
 * Search-then-propose. Never creates a duplicate.
 *
 * Every path that could produce a second row for the same concept returns the
 * existing one instead: an exact slug hit returns it, a merged term returns
 * its survivor, and the unique index is the backstop if two requests race.
 */
export async function proposeTerm(
  db: Db,
  kind: TermKind,
  rawName: string,
  userId: string,
): Promise<ProposeResult> {
  const prepared = prepareCatalogTerm(rawName);
  if (!prepared.ok) return { outcome: "invalid", reason: prepared.reason };

  const table = TABLES[kind];

  const [existing] = (await db
    .select({
      id: table.id,
      name: table.name,
      slug: table.slug,
      status: table.status,
      mergedIntoId: table.mergedIntoId,
    })
    .from(table)
    .where(eq(table.slug, prepared.slug))
    .limit(1)) as Term[];

  if (existing) {
    if (existing.status === "merged") {
      const survivor = await resolveTerm(db, kind, existing.id);
      return { outcome: "resolved", term: survivor ?? existing };
    }
    if (existing.status === "rejected") {
      return { outcome: "rejected-previously", term: existing };
    }
    return { outcome: "existing", term: existing };
  }

  try {
    const [created] = (await db
      .insert(table)
      .values({
        name: prepared.name,
        slug: prepared.slug,
        status: "pending",
        createdBy: userId,
      })
      .returning({
        id: table.id,
        name: table.name,
        slug: table.slug,
        status: table.status,
        mergedIntoId: table.mergedIntoId,
      })) as Term[];

    return { outcome: "created", term: created };
  } catch (error) {
    // Two sellers proposing the same brand at the same moment both pass the
    // SELECT above. The unique index catches the loser; return the winner
    // rather than surfacing a constraint violation.
    if (isUniqueViolation(error)) {
      const [raced] = (await db
        .select({
          id: table.id,
          name: table.name,
          slug: table.slug,
          status: table.status,
          mergedIntoId: table.mergedIntoId,
        })
        .from(table)
        .where(eq(table.slug, prepared.slug))
        .limit(1)) as Term[];

      if (raced) return { outcome: "existing", term: raced };
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "23505"
  );
}

/**
 * Follows a merge pointer to the surviving term.
 *
 * Chains are kept flat at merge time, so this normally resolves in one hop.
 * The depth cap is a guard against a cycle created by a bad migration rather
 * than something expected to be hit.
 */
export async function resolveTerm(
  db: Db,
  kind: TermKind,
  id: string,
  maxDepth = 5,
): Promise<Term | null> {
  const table = TABLES[kind];
  let currentId: string | null = id;

  for (let depth = 0; depth < maxDepth && currentId; depth++) {
    const [row] = (await db
      .select({
        id: table.id,
        name: table.name,
        slug: table.slug,
        status: table.status,
        mergedIntoId: table.mergedIntoId,
      })
      .from(table)
      .where(eq(table.id, currentId))
      .limit(1)) as Term[];

    if (!row) return null;
    if (row.status !== "merged" || !row.mergedIntoId) return row;
    currentId = row.mergedIntoId;
  }

  return null;
}

/**
 * Recomputes the denormalised search keywords for a set of products.
 *
 * `products.search_vector` is a generated column and can only read its own
 * row, so brand and tag names have to be cached on the product. Anything that
 * renames or merges a term has to call this or search silently goes stale.
 */
export async function refreshSearchKeywords(db: Db, productIds: string[]) {
  if (productIds.length === 0) return;

  await db.execute(sql`
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
