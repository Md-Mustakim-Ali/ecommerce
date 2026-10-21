import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { cache } from "react";
import { db } from "@/lib/db";
import {
  roles,
  storeMemberRoles,
  storeMembers,
  stores,
  userPlatformRoles,
} from "@/lib/db/schema";
import { effectiveStorePermissions, type StoreAccess } from "./access-rules";
import { getSession } from "./guards";
import {
  isPlatformPermission,
  type PlatformPermission,
  type StorePermission,
} from "./permissions";

/**
 * Database-backed authorisation.
 *
 * Every check goes through here. The pure decision logic lives in
 * access-rules.ts so it can be tested exhaustively; this file only supplies it
 * with rows.
 *
 * `cache()` dedupes within a request — a layout guard, a page, and three
 * server actions asking about the same store cost one lookup.
 */

export type PlatformAccess = {
  userId: string;
  permissions: ReadonlySet<PlatformPermission>;
};

export const getStoreAccess = cache(
  async (storeId: string): Promise<StoreAccess | null> => {
    const session = await getSession();
    if (!session) return null;

    const store = await db.query.stores.findFirst({
      where: eq(stores.id, storeId),
      columns: { id: true, ownerId: true },
    });
    if (!store) return null;

    const userId = session.user.id;

    // The owner short-circuits everything. No membership row is required and
    // none can take these permissions away.
    if (store.ownerId === userId) {
      return {
        storeId,
        userId,
        isOwner: true,
        membershipStatus: "owner",
        permissions: effectiveStorePermissions({
          isOwner: true,
          membershipStatus: "owner",
          rolePermissions: [],
        }),
      };
    }

    const member = await db.query.storeMembers.findFirst({
      where: and(
        eq(storeMembers.storeId, storeId),
        eq(storeMembers.userId, userId),
      ),
      columns: { id: true, status: true },
    });

    if (!member) {
      return {
        storeId,
        userId,
        isOwner: false,
        membershipStatus: "none",
        permissions: new Set(),
      };
    }

    const assigned = await db
      .select({ permissions: roles.permissions })
      .from(storeMemberRoles)
      .innerJoin(roles, eq(roles.id, storeMemberRoles.roleId))
      .where(eq(storeMemberRoles.memberId, member.id));

    return {
      storeId,
      userId,
      isOwner: false,
      membershipStatus: member.status,
      permissions: effectiveStorePermissions({
        isOwner: false,
        membershipStatus: member.status,
        rolePermissions: assigned.map((row) => row.permissions ?? []),
      }),
    };
  },
);

/**
 * Gate for a seller-side page or server action.
 *
 * notFound() for both "no access to this store" and "lacks this permission".
 *
 * Two reasons rather than one. It avoids telling a stranger that store X
 * exists but is not theirs, and it avoids enumerating which permissions exist
 * to somebody probing for them.
 *
 * Next's forbidden() would be the more precise signal, but in 16 it is still
 * gated behind experimental.authInterrupts and throws a 500 without it. Not a
 * flag worth enabling in a payments application to distinguish 403 from 404.
 */
export async function requireStorePermission(
  storeId: string,
  permission: StorePermission,
): Promise<StoreAccess> {
  const access = await getStoreAccess(storeId);

  if (!access || access.membershipStatus === "none") notFound();
  if (!access.permissions.has(permission)) notFound();

  return access;
}

export const getPlatformAccess = cache(
  async (): Promise<PlatformAccess | null> => {
    const session = await getSession();
    if (!session) return null;

    const assigned = await db
      .select({ permissions: roles.permissions })
      .from(userPlatformRoles)
      .innerJoin(roles, eq(roles.id, userPlatformRoles.roleId))
      .where(eq(userPlatformRoles.userId, session.user.id));

    const granted = new Set<PlatformPermission>();
    for (const row of assigned) {
      for (const key of row.permissions ?? []) {
        // A key retired from the vocabulary must not grant anything.
        if (isPlatformPermission(key)) granted.add(key);
      }
    }

    return { userId: session.user.id, permissions: granted };
  },
);

export async function requirePlatformPermission(
  permission: PlatformPermission,
): Promise<PlatformAccess> {
  const access = await getPlatformAccess();

  // The admin panel should not acknowledge its own existence to a signed-out
  // visitor or an ordinary buyer.
  if (!access || access.permissions.size === 0) notFound();
  if (!access.permissions.has(permission)) notFound();

  return access;
}

/** Every store this user can act in, owned or staffed. For the store switcher. */
export const getUserStores = cache(async () => {
  const session = await getSession();
  if (!session) return [];

  const owned = await db
    .select({
      id: stores.id,
      name: stores.name,
      slug: stores.slug,
      status: stores.status,
    })
    .from(stores)
    .where(eq(stores.ownerId, session.user.id));

  const staffed = await db
    .select({
      id: stores.id,
      name: stores.name,
      slug: stores.slug,
      status: stores.status,
    })
    .from(storeMembers)
    .innerJoin(stores, eq(stores.id, storeMembers.storeId))
    .where(
      and(
        eq(storeMembers.userId, session.user.id),
        eq(storeMembers.status, "active"),
      ),
    );

  // An owner who is also a member row would otherwise appear twice.
  const seen = new Set(owned.map((s) => s.id));
  return [...owned, ...staffed.filter((s) => !seen.has(s.id))];
});
