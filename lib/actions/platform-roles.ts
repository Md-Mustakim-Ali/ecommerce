"use server";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePlatformPermission } from "@/lib/auth/access";
import {
  permissionDiff,
  validatePlatformAssignment,
  validatePlatformGrant,
} from "@/lib/auth/access-rules";
import { getSession } from "@/lib/auth/guards";
import {
  PERMISSION_VOCABULARY_VERSION,
  type PlatformPermission,
} from "@/lib/auth/permissions";
import { slugify } from "@/lib/catalog/normalize";
import { db } from "@/lib/db";
import { auditLog, roles, user, userPlatformRoles } from "@/lib/db/schema";

/**
 * Platform-scope roles.
 *
 * The store version has an owner to fall back on — `stores.owner_id` implicitly
 * holds everything and cannot be locked out. There is no equivalent here, so
 * the ceiling check is the only thing standing between `platform.role.manage`
 * and a full takeover, and every mutation goes through it.
 *
 * The last holder of `platform.role.manage` cannot be stripped of it. Nobody
 * would be able to grant it back, and recovering would mean a database
 * console.
 */

export type PlatformRoleResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

function explain(
  rejection: Exclude<ReturnType<typeof validatePlatformGrant>, { ok: true }>,
): string {
  switch (rejection.reason) {
    case "unknown-permission":
      return `Not a platform permission: ${rejection.keys.join(", ")}.`;
    case "exceeds-ceiling":
      return `You cannot grant what you do not hold: ${rejection.keys.join(", ")}.`;
    case "system-role-immutable":
      return "Built-in roles cannot be edited. Duplicate one and change the copy.";
  }
}

async function actor() {
  const session = await getSession();
  if (!session) return null;
  return { id: session.user.id, email: session.user.email };
}

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || "role";
  for (let suffix = 0; suffix < 50; suffix++) {
    const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
    const [existing] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(
        and(
          eq(roles.scope, "platform"),
          eq(roles.slug, candidate),
          isNull(roles.storeId),
        ),
      )
      .limit(1);
    if (!existing) return candidate;
  }
  return `${base}-${Date.now()}`;
}

const roleSchema = z.object({
  name: z.string().trim().min(2, "Give the role a name").max(60),
  description: z.string().trim().max(200).optional(),
  permissions: z.array(z.string()).max(200),
});

export async function createPlatformRoleAction(
  input: z.input<typeof roleSchema>,
): Promise<PlatformRoleResult> {
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  const access = await requirePlatformPermission("platform.role.manage");
  const who = await actor();
  if (!who) return { ok: false, message: "Not signed in." };

  const grant = validatePlatformGrant({
    actorPermissions: access.permissions,
    requested: data.permissions,
    targetIsSystemRole: false,
  });
  if (!grant.ok) return { ok: false, message: explain(grant) };

  const slug = await uniqueSlug(data.name);

  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(roles)
      .values({
        scope: "platform",
        storeId: null,
        slug,
        name: data.name,
        description: data.description || null,
        permissions: grant.permissions,
        permissionsVersion: PERMISSION_VOCABULARY_VERSION,
        isSystem: false,
      })
      .returning({ id: roles.id });

    await tx.insert(auditLog).values({
      storeId: null,
      actorId: who.id,
      actorEmail: who.email,
      action: "platform.role.create",
      targetType: "role",
      targetId: created.id,
      targetLabel: data.name,
      before: null,
      after: { permissions: grant.permissions },
    });
  });

  revalidatePath("/admin/roles");
  return { ok: true, message: `Created ${data.name}.` };
}

export async function updatePlatformRoleAction(
  input: z.input<typeof roleSchema> & { roleId: string },
): Promise<PlatformRoleResult> {
  const parsed = roleSchema.extend({ roleId: z.uuid() }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  const access = await requirePlatformPermission("platform.role.manage");
  const who = await actor();
  if (!who) return { ok: false, message: "Not signed in." };

  const [existing] = await db
    .select({
      id: roles.id,
      name: roles.name,
      isSystem: roles.isSystem,
      permissions: roles.permissions,
    })
    .from(roles)
    .where(
      and(
        eq(roles.id, data.roleId),
        eq(roles.scope, "platform"),
        isNull(roles.storeId),
      ),
    )
    .limit(1);
  if (!existing) return { ok: false, message: "Role not found." };

  const grant = validatePlatformGrant({
    actorPermissions: access.permissions,
    requested: data.permissions,
    targetIsSystemRole: existing.isSystem,
  });
  if (!grant.ok) return { ok: false, message: explain(grant) };

  // Removing platform.role.manage from the last role that grants it would
  // leave nobody able to grant it back.
  const guard = await wouldOrphanRoleManagement({
    roleId: data.roleId,
    nextPermissions: grant.permissions,
  });
  if (guard) return { ok: false, message: guard };

  const diff = permissionDiff(existing.permissions ?? [], grant.permissions);

  await db.transaction(async (tx) => {
    await tx
      .update(roles)
      .set({
        name: data.name,
        description: data.description || null,
        permissions: grant.permissions,
        permissionsVersion: PERMISSION_VOCABULARY_VERSION,
      })
      .where(eq(roles.id, data.roleId));

    await tx.insert(auditLog).values({
      storeId: null,
      actorId: who.id,
      actorEmail: who.email,
      action: "platform.role.update",
      targetType: "role",
      targetId: data.roleId,
      targetLabel: data.name,
      before: { name: existing.name, removed: diff.removed },
      after: { name: data.name, added: diff.added },
    });
  });

  revalidatePath("/admin/roles");
  return { ok: true, message: `Saved ${data.name}.` };
}

export async function deletePlatformRoleAction(input: {
  roleId: string;
}): Promise<PlatformRoleResult> {
  const roleId = z.uuid().parse(input.roleId);

  await requirePlatformPermission("platform.role.manage");
  const who = await actor();
  if (!who) return { ok: false, message: "Not signed in." };

  const [existing] = await db
    .select({
      id: roles.id,
      name: roles.name,
      isSystem: roles.isSystem,
      permissions: roles.permissions,
    })
    .from(roles)
    .where(
      and(
        eq(roles.id, roleId),
        eq(roles.scope, "platform"),
        isNull(roles.storeId),
      ),
    )
    .limit(1);
  if (!existing) return { ok: false, message: "Role not found." };
  if (existing.isSystem) {
    return { ok: false, message: "Built-in roles cannot be deleted." };
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userPlatformRoles)
    .where(eq(userPlatformRoles.roleId, roleId));
  if (count > 0) {
    return {
      ok: false,
      message: `${count} ${count === 1 ? "person is" : "people are"} in this role. Move them out first.`,
    };
  }

  const guard = await wouldOrphanRoleManagement({
    roleId,
    nextPermissions: [],
  });
  if (guard) return { ok: false, message: guard };

  await db.transaction(async (tx) => {
    await tx.delete(roles).where(eq(roles.id, roleId));
    await tx.insert(auditLog).values({
      storeId: null,
      actorId: who.id,
      actorEmail: who.email,
      action: "platform.role.delete",
      targetType: "role",
      targetId: roleId,
      targetLabel: existing.name,
      before: { permissions: existing.permissions },
      after: null,
    });
  });

  revalidatePath("/admin/roles");
  return { ok: true, message: `Deleted ${existing.name}.` };
}

const assignSchema = z.object({
  userId: z.string().min(1),
  roleIds: z.array(z.uuid()).max(10),
});

export async function setPlatformRolesAction(
  input: z.input<typeof assignSchema>,
): Promise<PlatformRoleResult> {
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const data = parsed.data;

  const access = await requirePlatformPermission("platform.role.manage");
  const who = await actor();
  if (!who) return { ok: false, message: "Not signed in." };

  const [target] = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(eq(user.id, data.userId))
    .limit(1);
  if (!target) return { ok: false, message: "User not found." };

  const before = await db
    .select({ name: roles.name })
    .from(userPlatformRoles)
    .innerJoin(roles, eq(roles.id, userPlatformRoles.roleId))
    .where(eq(userPlatformRoles.userId, data.userId));

  let chosen: { id: string; name: string }[] = [];

  if (data.roleIds.length > 0) {
    const found = await db
      .select({
        id: roles.id,
        name: roles.name,
        permissions: roles.permissions,
        scope: roles.scope,
      })
      .from(roles)
      .where(inArray(roles.id, data.roleIds));

    if (found.length !== new Set(data.roleIds).size) {
      return { ok: false, message: "One of those roles no longer exists." };
    }

    for (const role of found) {
      // A store role attached at platform scope would grant nothing and read
      // as if it granted something.
      if (role.scope !== "platform") {
        return { ok: false, message: "That is not a platform role." };
      }
      const check = validatePlatformAssignment({
        actorPermissions: access.permissions,
        rolePermissions: role.permissions ?? [],
      });
      if (!check.ok) {
        return {
          ok: false,
          message: `"${role.name}" grants more than you hold (${check.keys.join(", ")}), so you cannot assign it.`,
        };
      }
    }

    chosen = found.map((r) => ({ id: r.id, name: r.name }));
  }

  // Removing your own role management is how somebody locks themselves out.
  if (data.userId === who.id) {
    const keeps = await grantsRoleManagement(data.roleIds);
    if (!keeps) {
      return {
        ok: false,
        message:
          "That would remove your own role management. Ask another admin to do it.",
      };
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(userPlatformRoles)
      .where(eq(userPlatformRoles.userId, data.userId));

    if (chosen.length > 0) {
      await tx
        .insert(userPlatformRoles)
        .values(
          chosen.map((role) => ({ userId: data.userId, roleId: role.id })),
        );
    }

    await tx.insert(auditLog).values({
      storeId: null,
      actorId: who.id,
      actorEmail: who.email,
      action: "platform.role.assign",
      targetType: "user",
      targetId: data.userId,
      targetLabel: target.email,
      before: { roles: before.map((r) => r.name) },
      after: { roles: chosen.map((r) => r.name) },
    });
  });

  revalidatePath("/admin/roles");
  return { ok: true, message: `Updated roles for ${target.email}.` };
}

/** True when at least one of these roles grants platform.role.manage. */
async function grantsRoleManagement(roleIds: string[]): Promise<boolean> {
  if (roleIds.length === 0) return false;
  const found = await db
    .select({ permissions: roles.permissions })
    .from(roles)
    .where(inArray(roles.id, roleIds));
  return found.some((role) =>
    (role.permissions ?? []).includes("platform.role.manage"),
  );
}

/**
 * Guards the last route back in.
 *
 * If this role is the only one granting `platform.role.manage` to anybody,
 * removing that permission — or the role — leaves nobody able to grant it
 * back, and recovery means a database console.
 */
async function wouldOrphanRoleManagement(input: {
  roleId: string;
  nextPermissions: readonly PlatformPermission[];
}): Promise<string | null> {
  if (input.nextPermissions.includes("platform.role.manage")) return null;

  // Roles other than this one that still grant it, and are actually assigned.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userPlatformRoles)
    .innerJoin(roles, eq(roles.id, userPlatformRoles.roleId))
    .where(
      and(
        sql`${roles.id} <> ${input.roleId}`,
        sql`${roles.permissions} @> '["platform.role.manage"]'::jsonb`,
      ),
    );

  return count > 0
    ? null
    : "This is the only role that can manage roles. Removing it would lock everyone out.";
}

/** Platform roles, with how many people hold each. */
export async function listPlatformRolesAction() {
  await requirePlatformPermission("platform.role.manage");

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
    .where(and(eq(roles.scope, "platform"), isNull(roles.storeId)))
    .orderBy(asc(roles.name));

  const counts = await db
    .select({
      roleId: userPlatformRoles.roleId,
      count: sql<number>`count(*)::int`,
    })
    .from(userPlatformRoles)
    .groupBy(userPlatformRoles.roleId);

  const byRole = new Map(counts.map((row) => [row.roleId, row.count]));

  return rows.map((row) => ({
    ...row,
    permissions: row.permissions ?? [],
    memberCount: byRole.get(row.id) ?? 0,
  }));
}

/** Everyone holding a platform role. */
export async function listPlatformStaffAction() {
  await requirePlatformPermission("platform.role.manage");

  const rows = await db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      roleId: roles.id,
      roleName: roles.name,
    })
    .from(userPlatformRoles)
    .innerJoin(user, eq(user.id, userPlatformRoles.userId))
    .innerJoin(roles, eq(roles.id, userPlatformRoles.roleId))
    .orderBy(asc(user.name));

  const byUser = new Map<
    string,
    {
      userId: string;
      name: string;
      email: string;
      roles: { id: string; name: string }[];
    }
  >();

  for (const row of rows) {
    const entry = byUser.get(row.userId) ?? {
      userId: row.userId,
      name: row.name,
      email: row.email,
      roles: [],
    };
    entry.roles.push({ id: row.roleId, name: row.roleName });
    byUser.set(row.userId, entry);
  }

  return [...byUser.values()];
}
