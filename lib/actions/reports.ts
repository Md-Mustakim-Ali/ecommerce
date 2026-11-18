"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePlatformPermission } from "@/lib/auth/access";
import { getSession } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { products, reports, reviews } from "@/lib/db/schema";
import { checkRateLimit } from "@/lib/ratelimit";

/**
 * Buyers telling us something is wrong, and admins deciding about it.
 *
 * ── Why the store is resolved here and not sent by the client ────────────
 *
 * A report carries `store_id` so a seller can be shown their own complaints and
 * nobody else's. If the client supplied it, anyone could file a report against
 * a rival's store by naming it — the whole scoping guarantee would rest on a
 * value the reporter chose. It is looked up from the target instead, which is
 * the only way it can be trusted.
 */

export type ReportResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

const reasons = [
  "counterfeit",
  "prohibited",
  "misleading",
  "offensive",
  "spam",
  "intellectual_property",
  "other",
] as const;

const submitSchema = z.object({
  targetType: z.enum(["product", "review", "store"]),
  targetId: z.uuid(),
  reason: z.enum(reasons),
  detail: z.string().trim().max(1000).optional(),
});

export async function submitReportAction(
  input: z.input<typeof submitSchema>,
): Promise<ReportResult> {
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const { targetType, targetId, reason, detail } = parsed.data;

  /*
    Signed in only.

    An anonymous report button is a button for brigading a competitor, and with
    nobody attached there is no way to notice one person filing forty. It is a
    small barrier to a genuine complaint and a large one to a campaign.
  */
  const session = await getSession();
  if (!session) {
    return { ok: false, message: "Please sign in to report this." };
  }

  // Keyed on the reporter. Somebody working through a rival's whole catalogue
  // is the abuse this stops; a person reporting two things in a day is not.
  const limit = await checkRateLimit("report", session.user.id);
  if (!limit.ok) return { ok: false, message: limit.message };

  // The store answerable for the target, resolved server-side.
  const owner = await resolveOwner(targetType, targetId);
  if (!owner) return { ok: false, message: "That is no longer available." };

  try {
    await db.insert(reports).values({
      reporterId: session.user.id,
      targetType,
      targetId,
      storeId: owner.storeId,
      productId: owner.productId,
      reviewId: owner.reviewId,
      reason,
      detail: detail || null,
    });
  } catch {
    /*
      Almost certainly the partial unique index: this person already has an open
      report against this thing. Told as success, deliberately — the outcome
      they wanted is true, and "you already reported this" invites them to go
      looking for a way to report it again.
    */
    return { ok: true, message: "Thanks — we already have your report." };
  }

  return {
    ok: true,
    message: "Thanks. Someone will look at this.",
  };
}

/** Where a report belongs, worked out from the thing being reported. */
async function resolveOwner(
  targetType: "product" | "review" | "store",
  targetId: string,
): Promise<{
  storeId: string;
  productId: string | null;
  reviewId: string | null;
} | null> {
  if (targetType === "store") {
    return { storeId: targetId, productId: null, reviewId: null };
  }

  if (targetType === "product") {
    const [row] = await db
      .select({ storeId: products.storeId })
      .from(products)
      .where(eq(products.id, targetId))
      .limit(1);
    return row
      ? { storeId: row.storeId, productId: targetId, reviewId: null }
      : null;
  }

  // A review belongs to a product, which belongs to a store.
  const [row] = await db
    .select({ storeId: products.storeId, productId: products.id })
    .from(reviews)
    .innerJoin(products, eq(products.id, reviews.productId))
    .where(eq(reviews.id, targetId))
    .limit(1);

  return row
    ? { storeId: row.storeId, productId: row.productId, reviewId: targetId }
    : null;
}

const resolveSchema = z.object({
  reportIds: z.array(z.uuid()).min(1).max(50),
  status: z.enum(["reviewing", "upheld", "dismissed"]),
  note: z.string().trim().max(500).optional(),
});

/**
 * An admin's decision.
 *
 * Upholding a report does NOT remove anything by itself, and that is
 * deliberate. Taking a product down is `moderateProductAction`, hiding a review
 * is `moderateReviewAction`, and both already exist with their own permissions
 * and their own audit entries. Wiring removal into this one would mean a
 * permission to resolve reports quietly became a permission to unpublish any
 * product on the platform.
 */
export async function resolveReportsAction(
  input: z.input<typeof resolveSchema>,
): Promise<ReportResult> {
  const parsed = resolveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const { reportIds, status, note } = parsed.data;

  await requirePlatformPermission("platform.report.resolve");
  const session = await getSession();
  if (!session) return { ok: false, message: "Not signed in." };

  const settled = status !== "reviewing";

  await db
    .update(reports)
    .set({
      status,
      resolutionNote: note || null,
      // `reviewing` is somebody picking it up, not finishing with it, so it
      // must not stamp a resolution time that later reads as "done".
      resolvedById: settled ? session.user.id : null,
      resolvedAt: settled ? new Date() : null,
    })
    .where(
      and(
        inArray(reports.id, reportIds),
        // Never re-decide something already settled: a second click on a stale
        // page would otherwise overwrite the first admin's decision and its
        // author.
        inArray(reports.status, ["open", "reviewing"]),
      ),
    );

  revalidatePath("/admin/moderation");

  return {
    ok: true,
    message:
      status === "reviewing"
        ? "Marked as being looked at."
        : `${reportIds.length} ${reportIds.length === 1 ? "report" : "reports"} ${status}.`,
  };
}
