"use server";

import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPlatformAccess, requireStorePermission } from "@/lib/auth/access";
import { getSession } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import {
  auditLog,
  discountCodes,
  discountRedemptions,
  stores,
} from "@/lib/db/schema";
import { normaliseCode } from "@/lib/discounts/apply";

/**
 * Creating and managing discount codes.
 *
 * Scope decides who is paying for the discount, so it is not something the
 * form gets to assert: a store-scoped code is pinned to the store whose
 * dashboard it was created from, and only platform staff can create one that
 * comes off everyone's margin.
 */

export type DiscountResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

type Scope = { scope: "platform" } | { scope: "store"; storeId: string };

const scopeSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("platform") }),
  z.object({ scope: z.literal("store"), storeId: z.uuid() }),
]);

/**
 * Authorises the scope and returns the actor.
 *
 * A store code is authorised against that store's own permission; a platform
 * code needs platform staff. There is no path where a seller creates a code
 * that spends the marketplace's money.
 */
async function authorise(scope: Scope) {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");

  if (scope.scope === "store") {
    await requireStorePermission(scope.storeId, "placement.manage");
  } else {
    const access = await getPlatformAccess();
    if (!access?.permissions.has("platform.settings.manage")) {
      throw new Error("Not allowed.");
    }
  }

  return { id: session.user.id, email: session.user.email };
}

const codeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(3, "A code needs at least three characters")
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, "Letters, numbers, dashes and underscores only"),
  kind: z.enum(["percentage", "fixed_amount", "free_shipping"]),
  /** Percent for a percentage code, major units for a fixed one. */
  value: z.string().trim().default("0"),
  maxDiscount: z.string().trim().optional(),
  minSubtotal: z.string().trim().optional(),
  maxRedemptions: z.string().trim().optional(),
  perCustomerLimit: z.string().trim().optional(),
  description: z.string().trim().max(200).optional(),
  startsAt: z.string().trim().optional(),
  endsAt: z.string().trim().optional(),
  publish: z.boolean().default(false),
});

/** Major units to minor, parsed from a decimal string rather than a float. */
function toCents(value: string | undefined): number | null {
  if (!value || value.trim() === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
}

function toInt(value: string | undefined): number | null {
  if (!value || value.trim() === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * `value` means a different thing per kind, so it is parsed per kind.
 *
 * Shared by create and update rather than written twice — two copies of a
 * money parser is two places for a rounding rule to drift apart.
 */
function parseValue(data: z.output<typeof codeSchema>): {
  value: number;
  error?: string;
} {
  if (data.kind === "percentage") {
    const percent = Number(data.value);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      return { value: 0, error: "Enter a percentage between 0 and 100." };
    }
    // Basis points, so 12.5% is exact rather than a rounded float.
    return { value: Math.round(percent * 100) };
  }

  if (data.kind === "fixed_amount") {
    const cents = toCents(data.value);
    if (cents === null || cents <= 0) {
      return { value: 0, error: "Enter an amount like 10.00." };
    }
    return { value: cents };
  }

  // free_shipping carries no value of its own.
  return { value: 0 };
}

export async function createDiscountAction(
  input: Scope & z.input<typeof codeSchema>,
): Promise<DiscountResult> {
  const scope = scopeSchema.safeParse(input);
  if (!scope.success) return { ok: false, message: "Invalid scope." };

  const parsed = codeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  let actor: { id: string; email: string };
  try {
    actor = await authorise(scope.data);
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }

  const code = normaliseCode(data.code);

  // Codes are global, so the uniqueness check has to be too. Two stores both
  // publishing SUMMER20 would make the code ambiguous at the one moment it has
  // to be unambiguous — when a buyer types it.
  const [clash] = await db
    .select({ id: discountCodes.id })
    .from(discountCodes)
    .where(sql`upper(${discountCodes.code}) = ${code}`)
    .limit(1);
  if (clash) {
    return { ok: false, message: `${code} is already in use.` };
  }

  const parsedValue = parseValue(data);
  if (parsedValue.error) return { ok: false, message: parsedValue.error };
  const value = parsedValue.value;

  const starts = data.startsAt ? new Date(data.startsAt) : null;
  const ends = data.endsAt ? new Date(data.endsAt) : null;
  if (starts && ends && ends <= starts) {
    return { ok: false, message: "The end must come after the start." };
  }

  const [created] = await db
    .insert(discountCodes)
    .values({
      code,
      scope: scope.data.scope,
      storeId: scope.data.scope === "store" ? scope.data.storeId : null,
      kind: data.kind,
      value,
      maxDiscountCents:
        data.kind === "percentage" ? toCents(data.maxDiscount) : null,
      minSubtotalCents: toCents(data.minSubtotal) ?? 0,
      maxRedemptions: toInt(data.maxRedemptions),
      perCustomerLimit: toInt(data.perCustomerLimit),
      description: data.description || null,
      status: data.publish ? "published" : "draft",
      startsAt: starts,
      endsAt: ends,
      createdBy: actor.id,
    })
    .returning({ id: discountCodes.id });

  await db.insert(auditLog).values({
    storeId: scope.data.scope === "store" ? scope.data.storeId : null,
    actorId: actor.id,
    actorEmail: actor.email,
    action: "discount.create",
    targetType: "discount_code",
    targetId: created.id,
    targetLabel: code,
    before: null,
    after: {
      kind: data.kind,
      value,
      status: data.publish ? "published" : "draft",
    },
  });

  revalidatePath(
    scope.data.scope === "store"
      ? `/dashboard/${scope.data.storeId}/discounts`
      : "/admin/discounts",
  );

  return {
    ok: true,
    message: data.publish ? `${code} is live.` : `${code} saved as a draft.`,
  };
}

/**
 * Edits a discount code's terms.
 *
 * Everything except the code itself. The code is what a buyer typed and what a
 * redemption row points at, so renaming it would silently invalidate anything
 * already circulating — a printed card, an email, a post — while leaving the
 * redemptions attached to a name nobody can use again.
 *
 * Editing the value of a code that has already been redeemed does not rewrite
 * those redemptions: each one recorded the amount it actually gave at the time,
 * for exactly this reason. Past orders keep the discount they were given.
 */
export async function updateDiscountAction(
  input: Scope & { discountId: string } & z.input<typeof codeSchema>,
): Promise<DiscountResult> {
  const scope = scopeSchema.safeParse(input);
  if (!scope.success) return { ok: false, message: "Invalid scope." };

  const discountId = z.uuid().safeParse(input.discountId);
  if (!discountId.success) return { ok: false, message: "Invalid request." };

  const parsed = codeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  let actor: { id: string; email: string };
  try {
    actor = await authorise(scope.data);
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }

  // Scoped, so a discount id belonging to the platform or another store does
  // not resolve however valid the uuid is.
  const [existing] = await db
    .select({
      id: discountCodes.id,
      code: discountCodes.code,
      kind: discountCodes.kind,
      value: discountCodes.value,
    })
    .from(discountCodes)
    .where(
      and(
        eq(discountCodes.id, discountId.data),
        scope.data.scope === "store"
          ? eq(discountCodes.storeId, scope.data.storeId)
          : isNull(discountCodes.storeId),
      ),
    )
    .limit(1);

  if (!existing) return { ok: false, message: "Code not found." };

  const { value, error } = parseValue(data);
  if (error) return { ok: false, message: error };

  const starts = data.startsAt ? new Date(data.startsAt) : null;
  const ends = data.endsAt ? new Date(data.endsAt) : null;
  if (starts && ends && ends <= starts) {
    return { ok: false, message: "The end must come after the start." };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(discountCodes)
      .set({
        kind: data.kind,
        value,
        maxDiscountCents:
          data.kind === "percentage" ? toCents(data.maxDiscount) : null,
        minSubtotalCents: toCents(data.minSubtotal) ?? 0,
        maxRedemptions: toInt(data.maxRedemptions),
        perCustomerLimit: toInt(data.perCustomerLimit),
        description: data.description || null,
      })
      .where(eq(discountCodes.id, discountId.data));

    // Audited with the before value. Changing what a live code is worth is a
    // change to what the marketplace is promising, and "who moved this from
    // 10% to 40%" has to be answerable.
    await tx.insert(auditLog).values({
      storeId: scope.data.scope === "store" ? scope.data.storeId : null,
      actorId: actor.id,
      actorEmail: actor.email,
      action: "discount.update",
      targetType: "discount_code",
      targetId: existing.id,
      targetLabel: existing.code,
      before: { kind: existing.kind, value: existing.value },
      after: { kind: data.kind, value },
    });
  });

  revalidatePath(
    scope.data.scope === "store"
      ? `/dashboard/${scope.data.storeId}/discounts`
      : "/admin/discounts",
  );

  return { ok: true, message: `${existing.code} updated.` };
}

const statusSchema = z.object({
  discountId: z.uuid(),
  status: z.enum(["draft", "published", "archived"]),
});

export async function setDiscountStatusAction(
  input: Scope & z.input<typeof statusSchema>,
): Promise<DiscountResult> {
  const scope = scopeSchema.safeParse(input);
  if (!scope.success) return { ok: false, message: "Invalid scope." };

  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid status." };

  let actor: { id: string; email: string };
  try {
    actor = await authorise(scope.data);
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }

  const owned = await ownedDiscount(parsed.data.discountId, scope.data);
  if (!owned) return { ok: false, message: "Code not found." };

  await db
    .update(discountCodes)
    .set({ status: parsed.data.status })
    .where(eq(discountCodes.id, parsed.data.discountId));

  await db.insert(auditLog).values({
    storeId: scope.data.scope === "store" ? scope.data.storeId : null,
    actorId: actor.id,
    actorEmail: actor.email,
    action: `discount.${parsed.data.status}`,
    targetType: "discount_code",
    targetId: owned.id,
    targetLabel: owned.code,
    before: { status: owned.status },
    after: { status: parsed.data.status },
  });

  revalidatePath(
    scope.data.scope === "store"
      ? `/dashboard/${scope.data.storeId}/discounts`
      : "/admin/discounts",
  );

  return { ok: true, message: `${owned.code} is now ${parsed.data.status}.` };
}

export async function deleteDiscountAction(
  input: Scope & { discountId: string },
): Promise<DiscountResult> {
  const scope = scopeSchema.safeParse(input);
  if (!scope.success) return { ok: false, message: "Invalid scope." };
  const discountId = z.uuid().parse(input.discountId);

  try {
    await authorise(scope.data);
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }

  const owned = await ownedDiscount(discountId, scope.data);
  if (!owned) return { ok: false, message: "Code not found." };

  // A redeemed code is part of the record of what an order was charged.
  // Deleting it would cascade the redemptions away with it, so it can only be
  // archived.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(discountRedemptions)
    .where(eq(discountRedemptions.discountId, discountId));

  if (count > 0) {
    return {
      ok: false,
      message: `${owned.code} has been used ${count} ${count === 1 ? "time" : "times"}. Archive it instead.`,
    };
  }

  await db.delete(discountCodes).where(eq(discountCodes.id, discountId));

  revalidatePath(
    scope.data.scope === "store"
      ? `/dashboard/${scope.data.storeId}/discounts`
      : "/admin/discounts",
  );

  return { ok: true, message: `${owned.code} deleted.` };
}

/** Scoped lookup, so an id from another store resolves to nothing. */
async function ownedDiscount(discountId: string, scope: Scope) {
  const [row] = await db
    .select({
      id: discountCodes.id,
      code: discountCodes.code,
      status: discountCodes.status,
    })
    .from(discountCodes)
    .where(
      and(
        eq(discountCodes.id, discountId),
        scope.scope === "store"
          ? eq(discountCodes.storeId, scope.storeId)
          : isNull(discountCodes.storeId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export type DiscountRow = {
  id: string;
  code: string;
  scope: "platform" | "store";
  storeName: string | null;
  kind: "percentage" | "fixed_amount" | "free_shipping";
  value: number;
  maxDiscountCents: number | null;
  minSubtotalCents: number;
  maxRedemptions: number | null;
  redemptionCount: number;
  perCustomerLimit: number | null;
  status: "draft" | "published" | "archived";
  startsAt: Date | null;
  endsAt: Date | null;
  description: string | null;
  /** What it has actually taken off, across every redemption. */
  redeemedCents: number;
};

/**
 * Codes in a scope, with what each has actually cost.
 *
 * The redeemed total is the number that matters after a campaign runs — a code
 * with 400 uses is only good news alongside what it gave away.
 */
export async function listDiscountsAction(
  input: Scope,
): Promise<DiscountRow[]> {
  const scope = scopeSchema.parse(input);
  await authorise(scope);

  const rows = await db
    .select({
      id: discountCodes.id,
      code: discountCodes.code,
      scope: discountCodes.scope,
      storeName: stores.name,
      kind: discountCodes.kind,
      value: discountCodes.value,
      maxDiscountCents: discountCodes.maxDiscountCents,
      minSubtotalCents: discountCodes.minSubtotalCents,
      maxRedemptions: discountCodes.maxRedemptions,
      redemptionCount: discountCodes.redemptionCount,
      perCustomerLimit: discountCodes.perCustomerLimit,
      status: discountCodes.status,
      startsAt: discountCodes.startsAt,
      endsAt: discountCodes.endsAt,
      description: discountCodes.description,
    })
    .from(discountCodes)
    .leftJoin(stores, eq(stores.id, discountCodes.storeId))
    .where(
      scope.scope === "store"
        ? // A seller sees their own codes, and any platform code that applies
          // to their products — those come off their sale too, so hiding them
          // would leave a seller unable to explain their own numbers.
          or(
            eq(discountCodes.storeId, scope.storeId),
            isNull(discountCodes.storeId),
          )
        : isNull(discountCodes.storeId),
    )
    .orderBy(desc(discountCodes.createdAt));

  if (rows.length === 0) return [];

  // Totals in their own grouped query rather than a correlated subquery: an
  // outer column reference inside a raw sql template renders unqualified and
  // can silently bind to the wrong table.
  const totals = await db
    .select({
      discountId: discountRedemptions.discountId,
      redeemed: sql<number>`coalesce(sum(${discountRedemptions.amountCents}), 0)::int`,
    })
    .from(discountRedemptions)
    .groupBy(discountRedemptions.discountId);

  const byDiscount = new Map(totals.map((t) => [t.discountId, t.redeemed]));

  return rows.map((row) => ({
    ...row,
    redeemedCents: byDiscount.get(row.id) ?? 0,
  }));
}
