import { eq } from "drizzle-orm";
import {
  PERMISSION_VOCABULARY_VERSION,
  PLATFORM_PERMISSION_KEYS,
  type PlatformPermission,
  type StorePermission,
} from "@/lib/auth/permissions";
import type { Db } from "@/lib/db";
import { roles } from "@/lib/db/schema";

/**
 * Seeded roles. `isSystem` makes them immutable — customising one copies it
 * first, which is why validateGrant refuses to edit them in place.
 *
 * Store templates have a null storeId: they are shared starting points that
 * every store can clone, not roles belonging to any one store.
 *
 * There is deliberately no "Owner" template. Ownership is `stores.owner_id`
 * and grants every store permission implicitly. A stored Owner role could be
 * edited or deleted, and an owner locked out of their own store is a support
 * ticket nobody can resolve without a database console.
 */

type SystemRole = {
  slug: string;
  name: string;
  description: string;
  permissions: readonly string[];
};

export const STORE_ROLE_TEMPLATES: readonly SystemRole[] = [
  {
    slug: "manager",
    name: "Manager",
    description:
      "Runs the store day to day. Everything except defining roles and removing staff.",
    permissions: [
      "product.view",
      "product.create",
      "product.update",
      "product.publish",
      "product.archive",
      "variant.manage",
      "inventory.update",
      "brand.propose",
      "tag.propose",
      "order.view",
      "order.accept",
      "order.ship",
      "order.cancel",
      "order.refund",
      "order.note",
      "customer.contact",
      "store.profile.update",
      "store.theme.update",
      "member.view",
      "member.invite",
      "member.assign_role",
      "role.view",
      "payout.view",
      "ledger.view",
      "report.sales.view",
      "audit.view",
    ] satisfies StorePermission[],
  },
  {
    slug: "fulfilment",
    name: "Fulfilment",
    description:
      "Picks, packs and ships. Can see orders but not revenue or payouts.",
    permissions: [
      "product.view",
      "inventory.update",
      "order.view",
      "order.accept",
      "order.ship",
      "order.note",
      "customer.contact",
    ] satisfies StorePermission[],
  },
  {
    slug: "catalog",
    name: "Catalog",
    description: "Builds and maintains listings. No access to orders or money.",
    permissions: [
      "product.view",
      "product.create",
      "product.update",
      "product.publish",
      "product.archive",
      "variant.manage",
      "inventory.update",
      "brand.propose",
      "tag.propose",
    ] satisfies StorePermission[],
  },
  {
    slug: "finance",
    name: "Finance",
    description: "Reads the numbers. Cannot change listings, orders or staff.",
    permissions: [
      "order.view",
      "payout.view",
      "ledger.view",
      "report.sales.view",
    ] satisfies StorePermission[],
  },
];

export const PLATFORM_ROLES: readonly SystemRole[] = [
  {
    slug: "super-admin",
    name: "Super Admin",
    description: "Every platform permission. Grant sparingly.",
    permissions: [...PLATFORM_PERMISSION_KEYS],
  },
  {
    slug: "support",
    name: "Support",
    description:
      "Looks things up to answer buyer and seller questions. Read-only.",
    permissions: [
      "platform.store.view",
      "platform.order.view",
      "platform.user.view",
    ] satisfies PlatformPermission[],
  },
  {
    slug: "moderation",
    name: "Moderation",
    description:
      "Reviews proposed brands and tags, and takes down content that breaks policy.",
    permissions: [
      "platform.brand.review",
      "platform.tag.review",
      "platform.category.manage",
      "platform.product.moderate",
      "platform.review.moderate",
      "platform.store.view",
    ] satisfies PlatformPermission[],
  },
  {
    slug: "finance",
    name: "Finance",
    description: "Approves refunds and sends payouts.",
    permissions: [
      "platform.ledger.view",
      "platform.payout.initiate",
      "platform.finance.report",
      "platform.refund.approve",
      "platform.order.view",
      "platform.store.view",
    ] satisfies PlatformPermission[],
  },
];

/**
 * Idempotent. Safe to run on every deploy — an existing system role has its
 * permissions brought up to date rather than being duplicated, so adding a key
 * to the vocabulary can be rolled out by re-running this.
 */
export async function seedSystemRoles(db: Db) {
  const rows = [
    ...STORE_ROLE_TEMPLATES.map((r) => ({ ...r, scope: "store" as const })),
    ...PLATFORM_ROLES.map((r) => ({ ...r, scope: "platform" as const })),
  ];

  for (const row of rows) {
    const existing = await db.query.roles.findFirst({
      where: (roles, { and, eq, isNull }) =>
        and(
          eq(roles.slug, row.slug),
          eq(roles.scope, row.scope),
          isNull(roles.storeId),
        ),
    });

    if (existing) {
      await db
        .update(roles)
        .set({
          name: row.name,
          description: row.description,
          permissions: row.permissions as never,
          permissionsVersion: PERMISSION_VOCABULARY_VERSION,
        })
        .where(eq(roles.id, existing.id));
      continue;
    }

    await db.insert(roles).values({
      scope: row.scope,
      storeId: null,
      slug: row.slug,
      name: row.name,
      description: row.description,
      permissions: row.permissions as never,
      permissionsVersion: PERMISSION_VOCABULARY_VERSION,
      isSystem: true,
    });
  }

  return rows.length;
}
