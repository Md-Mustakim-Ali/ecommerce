import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Permission } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import {
  auditLog,
  roles,
  storeMemberRoles,
  storeMembers,
  stores,
  user,
} from "@/lib/db/schema";

/**
 * Reads for the staff and roles screens.
 *
 * A store sees two kinds of role: the seeded system templates, which have a
 * null store_id and are shared by every store, and its own custom roles. Both
 * are assignable; only the custom ones are editable.
 */

export type RoleRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  permissions: Permission[];
  isSystem: boolean;
  memberCount: number;
};

export async function listRolesForStore(storeId: string): Promise<RoleRow[]> {
  const rows = await db
    .select({
      id: roles.id,
      slug: roles.slug,
      name: roles.name,
      description: roles.description,
      permissions: roles.permissions,
      isSystem: roles.isSystem,
    })
    .from(roles)
    .where(
      and(
        eq(roles.scope, "store"),
        or(eq(roles.storeId, storeId), isNull(roles.storeId)),
      ),
    )
    // System templates first, then the store's own, each alphabetical.
    .orderBy(desc(roles.isSystem), asc(roles.name));

  // Counted in its own query rather than a correlated subquery. Drizzle emits
  // an unqualified column for an outer reference inside a raw sql template, so
  // `roles.id` becomes a bare "id" that Postgres happily resolves against the
  // subquery's own tables — a silent wrong answer rather than an error.
  //
  // Scoped to this store, so a system template shared by every store reports
  // the people in it here, not the whole platform's headcount.
  const counts = await db
    .select({
      roleId: storeMemberRoles.roleId,
      count: sql<number>`count(*)::int`,
    })
    .from(storeMemberRoles)
    .innerJoin(storeMembers, eq(storeMembers.id, storeMemberRoles.memberId))
    .where(eq(storeMembers.storeId, storeId))
    .groupBy(storeMemberRoles.roleId);

  const countByRole = new Map(counts.map((row) => [row.roleId, row.count]));

  return rows.map((row) => ({
    ...row,
    permissions: row.permissions ?? [],
    memberCount: countByRole.get(row.id) ?? 0,
  }));
}

export type MemberRow = {
  id: string;
  userId: string;
  name: string;
  email: string;
  image: string | null;
  status: "invited" | "active" | "suspended";
  joinedAt: Date | null;
  roles: { id: string; name: string; isSystem: boolean }[];
};

export async function listMembersForStore(storeId: string): Promise<{
  owner: { id: string; name: string; email: string } | null;
  members: MemberRow[];
}> {
  const [store] = await db
    .select({
      ownerId: stores.ownerId,
      ownerName: user.name,
      ownerEmail: user.email,
    })
    .from(stores)
    .leftJoin(user, eq(user.id, stores.ownerId))
    .where(eq(stores.id, storeId))
    .limit(1);

  const rows = await db
    .select({
      id: storeMembers.id,
      userId: storeMembers.userId,
      name: user.name,
      email: user.email,
      image: user.image,
      status: storeMembers.status,
      joinedAt: storeMembers.joinedAt,
    })
    .from(storeMembers)
    .innerJoin(user, eq(user.id, storeMembers.userId))
    .where(eq(storeMembers.storeId, storeId))
    .orderBy(asc(user.name));

  const assigned = await db
    .select({
      memberId: storeMemberRoles.memberId,
      roleId: roles.id,
      roleName: roles.name,
      isSystem: roles.isSystem,
    })
    .from(storeMemberRoles)
    .innerJoin(roles, eq(roles.id, storeMemberRoles.roleId))
    .innerJoin(storeMembers, eq(storeMembers.id, storeMemberRoles.memberId))
    .where(eq(storeMembers.storeId, storeId));

  return {
    owner:
      store?.ownerId && store.ownerName && store.ownerEmail
        ? {
            id: store.ownerId,
            name: store.ownerName,
            email: store.ownerEmail,
          }
        : null,
    members: rows.map((row) => ({
      ...row,
      roles: assigned
        .filter((a) => a.memberId === row.id)
        .map((a) => ({ id: a.roleId, name: a.roleName, isSystem: a.isSystem })),
    })),
  };
}

/** Recent privileged changes in this store, newest first. */
export async function listAuditForStore(storeId: string, limit = 30) {
  return db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      actorEmail: auditLog.actorEmail,
      targetType: auditLog.targetType,
      targetLabel: auditLog.targetLabel,
      before: auditLog.before,
      after: auditLog.after,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(eq(auditLog.storeId, storeId))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}

/**
 * Stores this user has been invited to but has not accepted.
 *
 * Kept out of `getUserStores`, which only returns access that actually works.
 * An unaccepted invitation grants nothing, so listing it alongside real stores
 * would show a store that 404s when opened.
 */
export async function listPendingInvitations(userId: string) {
  // Aliased join rather than a correlated subquery, for the same reason as the
  // role counts above: an outer column reference inside a raw sql template is
  // emitted unqualified and binds to whichever table happens to have that name.
  const inviter = alias(user, "inviter");

  return db
    .select({
      storeId: stores.id,
      storeName: stores.name,
      storeSlug: stores.slug,
      invitedAt: storeMembers.invitedAt,
      invitedByEmail: inviter.email,
    })
    .from(storeMembers)
    .innerJoin(stores, eq(stores.id, storeMembers.storeId))
    .leftJoin(inviter, eq(inviter.id, storeMembers.invitedBy))
    .where(
      and(eq(storeMembers.userId, userId), eq(storeMembers.status, "invited")),
    )
    .orderBy(desc(storeMembers.invitedAt));
}

/** How many custom roles this store already has. Feeds the ceiling check. */
export async function countCustomRoles(storeId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(roles)
    .where(and(eq(roles.storeId, storeId), eq(roles.isSystem, false)));
  return row?.count ?? 0;
}
