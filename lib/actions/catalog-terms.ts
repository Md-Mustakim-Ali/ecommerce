"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  getPlatformAccess,
  requirePlatformPermission,
  requireStorePermission,
} from "@/lib/auth/access";
import { getSession } from "@/lib/auth/guards";
import type { PlatformPermission } from "@/lib/auth/permissions";
import { approveTerm, mergeTerms, rejectTerm } from "@/lib/catalog/term-review";
import {
  findSimilarTerms,
  proposeTerm,
  type SimilarTerm,
  searchApprovedTerms,
  type Term,
  type TermKind,
} from "@/lib/catalog/terms";
import { db } from "@/lib/db";

/**
 * Server actions for the brand and tag workflow.
 *
 * Every input is parsed with Zod rather than cast, and every action does its
 * own permission check. A server action is a public HTTP endpoint — the fact
 * that the only caller today is a form we control means nothing.
 */

const kindSchema = z.enum(["brand", "tag"]);
const uuidSchema = z.uuid();

const searchSchema = z.object({
  kind: kindSchema,
  storeId: uuidSchema,
  query: z.string().max(80),
});

const proposeSchema = z.object({
  kind: kindSchema,
  storeId: uuidSchema,
  name: z.string().min(1).max(80),
});

/** brand.propose / tag.propose, picked by kind. */
const proposePermission = (kind: TermKind) =>
  kind === "brand" ? ("brand.propose" as const) : ("tag.propose" as const);

/** platform.brand.review / platform.tag.review, picked by kind. */
const reviewPermission = (kind: TermKind): PlatformPermission =>
  kind === "brand" ? "platform.brand.review" : "platform.tag.review";

export type SearchTermsResult = {
  matches: Term[];
  /** Near-matches, shown as a warning before the seller proposes something new. */
  similar: SimilarTerm[];
};

export async function searchTermsAction(input: {
  kind: TermKind;
  storeId: string;
  query: string;
}): Promise<SearchTermsResult> {
  const parsed = searchSchema.parse(input);

  // Proposing is what this feeds into, so it is the permission that gates it.
  await requireStorePermission(parsed.storeId, proposePermission(parsed.kind));

  const [matches, similar] = await Promise.all([
    searchApprovedTerms(db, parsed.kind, parsed.query),
    // Only worth the trigram scan once there is enough to compare against.
    parsed.query.trim().length >= 3
      ? findSimilarTerms(db, parsed.kind, parsed.query)
      : Promise.resolve([]),
  ]);

  // An exact match is already in `matches`; repeating it as a "did you mean"
  // is noise.
  const exact = new Set(matches.map((m) => m.id));

  return { matches, similar: similar.filter((s) => !exact.has(s.id)) };
}

export type ProposeTermState = {
  status: "idle" | "created" | "existing" | "resolved" | "rejected" | "error";
  message?: string;
  term?: Term;
};

export async function proposeTermAction(input: {
  kind: TermKind;
  storeId: string;
  name: string;
}): Promise<ProposeTermState> {
  const parsed = proposeSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0].message };
  }

  await requireStorePermission(
    parsed.data.storeId,
    proposePermission(parsed.data.kind),
  );

  const session = await getSession();
  if (!session) return { status: "error", message: "Not signed in." };

  const result = await proposeTerm(
    db,
    parsed.data.kind,
    parsed.data.name,
    session.user.id,
  );

  switch (result.outcome) {
    case "created":
      revalidatePath("/admin/catalog");
      return {
        status: "created",
        term: result.term,
        message: "Submitted for review. You can use it on this product now.",
      };
    case "existing":
      return {
        status: "existing",
        term: result.term,
        message: `"${result.term.name}" already exists — selected it instead.`,
      };
    case "resolved":
      return {
        status: "resolved",
        term: result.term,
        message: `That was merged into "${result.term.name}" — selected it instead.`,
      };
    case "rejected-previously":
      return {
        status: "rejected",
        term: result.term,
        message: `"${result.term.name}" was reviewed and rejected. Pick a different one.`,
      };
    case "invalid":
      return {
        status: "error",
        message:
          result.reason === "no-alphanumeric"
            ? "Needs at least one letter or number."
            : result.reason === "too-long"
              ? "That name is too long."
              : "Enter a name.",
      };
  }
}

// ---------------------------------------------------------------------------
// Admin review
// ---------------------------------------------------------------------------

async function requireReviewer(kind: TermKind) {
  await requirePlatformPermission(reviewPermission(kind));
  const access = await getPlatformAccess();
  const session = await getSession();
  if (!access || !session) throw new Error("Not signed in");
  return { id: session.user.id, email: session.user.email };
}

export async function approveTermAction(input: {
  kind: TermKind;
  id: string;
}): Promise<{ ok: boolean; message: string }> {
  const kind = kindSchema.parse(input.kind);
  const id = uuidSchema.parse(input.id);
  const actor = await requireReviewer(kind);

  try {
    const row = await approveTerm(db, kind, id, actor);
    revalidatePath("/admin/catalog");
    return { ok: true, message: `Approved "${row.name}".` };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

export async function rejectTermAction(input: {
  kind: TermKind;
  id: string;
  reason: string;
}): Promise<{ ok: boolean; message: string }> {
  const kind = kindSchema.parse(input.kind);
  const id = uuidSchema.parse(input.id);
  const reason = z.string().min(1).max(200).parse(input.reason);
  const actor = await requireReviewer(kind);

  try {
    const row = await rejectTerm(db, kind, id, actor, reason);
    revalidatePath("/admin/catalog");
    return { ok: true, message: `Rejected "${row.name}".` };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

export async function mergeTermsAction(input: {
  kind: TermKind;
  loserId: string;
  survivorId: string;
}): Promise<{ ok: boolean; message: string }> {
  const kind = kindSchema.parse(input.kind);
  const loserId = uuidSchema.parse(input.loserId);
  const survivorId = uuidSchema.parse(input.survivorId);
  const actor = await requireReviewer(kind);

  try {
    const result = await mergeTerms(db, kind, loserId, survivorId, actor);
    revalidatePath("/admin/catalog");
    return {
      ok: true,
      message:
        result.movedProducts === 1
          ? "Merged. 1 product moved."
          : `Merged. ${result.movedProducts} products moved.`,
    };
  } catch (error) {
    // mergeTerms throws for self-merge, an already-merged loser, and cycles.
    // Those are user-correctable, so surface the message rather than a 500.
    return { ok: false, message: (error as Error).message };
  }
}
