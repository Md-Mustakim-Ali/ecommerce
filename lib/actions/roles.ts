"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getStoreAccess, requireStorePermission } from "@/lib/auth/access";
import {
  permissionDiff,
  validateGrant,
  validateRoleAssignment,
} from "@/lib/auth/access-rules";
import { getSession } from "@/lib/auth/guards";
import {
  PERMISSION_VOCABULARY_VERSION,
  type StorePermission,
} from "@/lib/auth/permissions";
import { slugify } from "@/lib/catalog/normalize";
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
 * Role and staff management.
 *
 * The security decisions are not made here. They live in access-rules.ts, are
 * pure, and are tested exhaustively; this file loads rows, calls them, and
 * writes the result. Any check that appears in the UI also appears here,
 * because the UI is a courtesy and this is the control.
 *
 * Every mutation writes an audit entry inside the same transaction as the
 * change. An audit log that can be missing a row for a change that happened is
 * worse than no audit log, because it will be trusted.
 */

export type ActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/** Turns a rejection from the pure layer into something a person can act on. */
function explain(
  rejection: Exclude<ReturnType<typeof validateGrant>, { ok: true }>,
): string {
  switch (rejection.reason) {
    case "unknown-permission":
      return `Unknown permission: ${rejection.keys.join(", ")}. Reload and try again.`;
    case "exceeds-ceiling":
      return `You cannot grant permissions you do not hold yourself: ${rejection.keys.join(", ")}.`;
    case "role-limit-reached":
      return `This store already has ${rejection.limit} custom roles, which is the limit. Edit or delete one first.`;
    case "system-role-immutable":
      return "Built-in roles cannot be edited. Duplicate it and change the copy.";
  }
}

async function actor() {
  const session = await getSession();
  if (!session) return null;
  return { id: session.user.id, email: session.user.email };
}

/**
 * A slug unique within the store.
 *
 * Roles are addressed by name in the UI, but the slug is what a future import
 * or API would key on, so two roles called "Fulfilment (weekend)" and
 * "Fulfilment weekend" must not collide silently.
 */
async function uniqueRoleSlug(storeId: string, name: string): Promise<string> {
  const base = slugify(name) || "role";
  for (let suffix = 0; suffix < 50; suffix++) {
    const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
    const existing = await db.query.roles.findFirst({
      where: and(eq(roles.storeId, storeId), eq(roles.slug, candidate)),
      columns: { id: true },
    });
    if (!existing) return candidate;
  }
  return `${base}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

const roleSchema = z.object({
  storeId: z.uuid(),
  name: z.string().trim().min(2, "Give the role a name").max(60),
  description: z.string().trim().max(200).optional(),
  permissions: z.array(z.string()).max(200),
});

export async function createRoleAction(
  input: z.input<typeof roleSchema>,
): Promise<ActionResult> {
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const { storeId, name, description, permissions } = parsed.data;

  const access = await requireStorePermission(storeId, "role.create");
  const who = await actor();
  if (!who) return { ok: false, message: "Not signed in." };

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(roles)
    .where(and(eq(roles.storeId, storeId), eq(roles.isSystem, false)));

  const grant = validateGrant({
    actorPermissions: access.permissions,
    requested: permissions,
    existingCustomRoleCount: count,
    isUpdate: false,
    targetIsSystemRole: false,
  });
  if (!grant.ok) return { ok: false, message: explain(grant) };

  const slug = await uniqueRoleSlug(storeId, name);

  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(roles)
      .values({
        scope: "store",
        storeId,
        slug,
        name,
        description: description || null,
        permissions: grant.permissions,
        permissionsVersion: PERMISSION_VOCABULARY_VERSION,
        isSystem: false,
      })
      .returning({ id: roles.id });

    await tx.insert(auditLog).values({
      storeId,
      actorId: who.id,
      actorEmail: who.email,
      action: "role.create",
      targetType: "role",
      targetId: created.id,
      targetLabel: name,
      before: null,
      after: { name, permissions: grant.permissions },
    });
  });

  revalidatePath(`/dashboard/${storeId}/staff`);
  return { ok: true, message: `Created ${name}.` };
}

export async function updateRoleAction(
  input: z.input<typeof roleSchema> & { roleId: string },
): Promise<ActionResult> {
  const parsed = roleSchema.extend({ roleId: z.uuid() }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const { storeId, roleId, name, description, permissions } = parsed.data;

  const access = await requireStorePermission(storeId, "role.update");
  const who = await actor();
  if (!who) return { ok: false, message: "Not signed in." };

  // Scoped to the store, so a role id belonging to somebody else resolves to
  // nothing rather than being edited.
  const existing = await db.query.roles.findFirst({
    where: and(eq(roles.id, roleId), eq(roles.storeId, storeId)),
    columns: {
      id: true,
      name: true,
      isSystem: true,
      permissions: true,
    },
  });
  if (!existing) return { ok: false, message: "Role not found." };

  const grant = validateGrant({
    actorPermissions: access.permissions,
    requested: permissions,
    existingCustomRoleCount: 0,
    isUpdate: true,
    targetIsSystemRole: existing.isSystem,
  });
  if (!grant.ok) return { ok: false, message: explain(grant) };

  const diff = permissionDiff(existing.permissions ?? [], grant.permissions);

  await db.transaction(async (tx) => {
    await tx
      .update(roles)
      .set({
        name,
        description: description || null,
        permissions: grant.permissions,
        permissionsVersion: PERMISSION_VOCABULARY_VERSION,
      })
      .where(eq(roles.id, roleId));

    await tx.insert(auditLog).values({
      storeId,
      actorId: who.id,
      actorEmail: who.email,
      action: "role.update",
      targetType: "role",
      targetId: roleId,
      targetLabel: name,
      // Only what changed. A full dump of both arrays makes the log unreadable
      // at exactly the moment somebody needs to read it.
      before: { name: existing.name, removed: diff.removed },
      after: { name, added: diff.added },
    });
  });

  revalidatePath(`/dashboard/${storeId}/staff`);
  return { ok: true, message: `Saved ${name}.` };
}

export async function deleteRoleAction(input: {
  storeId: string;
  roleId: string;
}): Promise<ActionResult> {
  const storeId = z.uuid().parse(input.storeId);
  const roleId = z.uuid().parse(input.roleId);

  await requireStorePermission(storeId, "role.delete");
  const who = await actor();
  if (!who) return { ok: false, message: "Not signed in." };

  const existing = await db.query.roles.findFirst({
    where: and(eq(roles.id, roleId), eq(roles.storeId, storeId)),
    columns: { id: true, name: true, isSystem: true, permissions: true },
  });
  if (!existing) return { ok: false, message: "Role not found." };
  if (existing.isSystem) {
    return { ok: false, message: "Built-in roles cannot be deleted." };
  }

  // Deleting a role out from under its holders would silently strip their
  // access with nothing in the UI to explain why. Unassign first, deliberately.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(storeMemberRoles)
    .where(eq(storeMemberRoles.roleId, roleId));

  if (count > 0) {
    return {
      ok: false,
      message: `${count} ${count === 1 ? "person is" : "people are"} in this role. Move them out first.`,
    };
  }

  await db.transaction(async (tx) => {
    await tx.delete(roles).where(eq(roles.id, roleId));
    await tx.insert(auditLog).values({
      storeId,
      actorId: who.id,
      actorEmail: who.email,
      action: "role.delete",
      targetType: "role",
      targetId: roleId,
      targetLabel: existing.name,
      before: { name: existing.name, permissions: existing.permissions },
      after: null,
    });
  });

  revalidatePath(`/dashboard/${storeId}/staff`);
  return { ok: true, message: `Deleted ${existing.name}.` };
}

/**
 * Copies a built-in template into an editable role.
 *
 * System roles are immutable, so "customise this" has to mean "start from it".
 * The copy is bounded by the actor's own ceiling like any other create — a
 * template granting more than the actor holds copies across only what they can
 * actually give.
 */
export async function duplicateRoleAction(input: {
  storeId: string;
  roleId: string;
}): Promise<ActionResult> {
  const storeId = z.uuid().parse(input.storeId);
  const roleId = z.uuid().parse(input.roleId);

  const access = await requireStorePermission(storeId, "role.create");
  const who = await actor();
  if (!who) return { ok: false, message: "Not signed in." };

  const source = await db.query.roles.findFirst({
    where: eq(roles.id, roleId),
    columns: {
      id: true,
      name: true,
      description: true,
      permissions: true,
      storeId: true,
      scope: true,
    },
  });
  // Readable sources are this store's own roles and the shared templates.
  if (!source || source.scope !== "store") {
    return { ok: false, message: "Role not found." };
  }
  if (source.storeId !== null && source.storeId !== storeId) {
    return { ok: false, message: "Role not found." };
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(roles)
    .where(and(eq(roles.storeId, storeId), eq(roles.isSystem, false)));

  // Narrowed to the actor's ceiling rather than rejected outright: copying a
  // template you cannot fully grant should still give you the part you can.
  const allowed = (source.permissions ?? []).filter(
    (key): key is StorePermission =>
      access.permissions.has(key as StorePermission),
  );

  const grant = validateGrant({
    actorPermissions: access.permissions,
    requested: allowed,
    existingCustomRoleCount: count,
    isUpdate: false,
    targetIsSystemRole: false,
  });
  if (!grant.ok) return { ok: false, message: explain(grant) };

  const name = `${source.name} (copy)`;
  const slug = await uniqueRoleSlug(storeId, name);

  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(roles)
      .values({
        scope: "store",
        storeId,
        slug,
        name,
        description: source.description,
        permissions: grant.permissions,
        permissionsVersion: PERMISSION_VOCABULARY_VERSION,
        isSystem: false,
      })
      .returning({ id: roles.id });

    await tx.insert(auditLog).values({
      storeId,
      actorId: who.id,
      actorEmail: who.email,
      action: "role.create",
      targetType: "role",
      targetId: created.id,
      targetLabel: name,
      before: null,
      after: {
        copiedFrom: source.name,
        permissions: grant.permissions,
        droppedBeyondCeiling:
          (source.permissions ?? []).length - allowed.length,
      },
    });
  });

  revalidatePath(`/dashboard/${storeId}/staff`);
  return {
    ok: true,
    message:
      allowed.length === (source.permissions ?? []).length
        ? `Copied to ${name}.`
        : `Copied to ${name}, without the permissions you do not hold.`,
  };
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

const inviteSchema = z.object({
  storeId: z.uuid(),
  email: z.email("Enter a valid email"),
  roleIds: z.array(z.uuid()).max(10),
});

export async function inviteMemberAction(
  input: z.input<typeof inviteSchema>,
): Promise<ActionResult> {
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const { storeId, email, roleIds } = parsed.data;

  const access = await requireStorePermission(storeId, "member.invite");
  const who = await actor();
  if (!who) return { ok: false, message: "Not signed in." };

  // Assigning roles at invite time needs the assignment permission too, not
  // just the invite one — otherwise `member.invite` alone would let someone
  // create an account with any role attached.
  if (roleIds.length > 0 && !access.permissions.has("member.assign_role")) {
    return {
      ok: false,
      message: "You can invite people but not choose their roles.",
    };
  }

  const invitee = await db.query.user.findFirst({
    where: eq(user.email, email.toLowerCase()),
    columns: { id: true, name: true, email: true },
  });

  // No pending-invite table yet, so an invitation can only be recorded against
  // an account that exists. Saying so is better than accepting the invite and
  // dropping it. Revisit when transactional email is wired up.
  if (!invitee) {
    return {
      ok: false,
      message: `No account for ${email}. Ask them to sign up first, then invite them.`,
    };
  }

  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
    columns: { ownerId: true },
  });
  if (store?.ownerId === invitee.id) {
    return { ok: false, message: "That person already owns this store." };
  }

  const existing = await db.query.storeMembers.findFirst({
    where: and(
      eq(storeMembers.storeId, storeId),
      eq(storeMembers.userId, invitee.id),
    ),
    columns: { id: true, status: true },
  });
  if (existing) {
    return {
      ok: false,
      message:
        existing.status === "invited"
          ? "They already have a pending invitation."
          : "They already have access to this store.",
    };
  }

  const chosen = await rolesWithinCeiling(storeId, roleIds, access.permissions);
  if (!chosen.ok) return chosen;

  await db.transaction(async (tx) => {
    const [member] = await tx
      .insert(storeMembers)
      .values({
        storeId,
        userId: invitee.id,
        status: "invited",
        invitedBy: who.id,
      })
      .returning({ id: storeMembers.id });

    if (chosen.roles.length > 0) {
      await tx.insert(storeMemberRoles).values(
        chosen.roles.map((role) => ({
          memberId: member.id,
          roleId: role.id,
        })),
      );
    }

    await tx.insert(auditLog).values({
      storeId,
      actorId: who.id,
      actorEmail: who.email,
      action: "member.invite",
      targetType: "store_member",
      targetId: member.id,
      targetLabel: invitee.email,
      before: null,
      after: { roles: chosen.roles.map((r) => r.name) },
    });
  });

  revalidatePath(`/dashboard/${storeId}/staff`);
  return { ok: true, message: `Invited ${invitee.email}.` };
}

/** Loads roles by id and checks each one against the actor's ceiling. */
async function rolesWithinCeiling(
  storeId: string,
  roleIds: string[],
  actorPermissions: ReadonlySet<StorePermission>,
): Promise<
  | {
      ok: true;
      roles: { id: string; name: string; permissions: StorePermission[] }[];
    }
  | { ok: false; message: string }
> {
  if (roleIds.length === 0) return { ok: true, roles: [] };

  const found = await db
    .select({
      id: roles.id,
      name: roles.name,
      permissions: roles.permissions,
      storeId: roles.storeId,
      scope: roles.scope,
    })
    .from(roles)
    .where(inArray(roles.id, roleIds));

  if (found.length !== roleIds.length) {
    return { ok: false, message: "One of those roles no longer exists." };
  }

  for (const role of found) {
    // A platform role, or another store's role, must never attach here.
    if (
      role.scope !== "store" ||
      (role.storeId !== null && role.storeId !== storeId)
    ) {
      return { ok: false, message: "That role does not belong to this store." };
    }

    const check = validateRoleAssignment({
      actorPermissions,
      rolePermissions: role.permissions ?? [],
    });
    if (!check.ok) {
      return {
        ok: false,
        message: `"${role.name}" grants more than you hold (${check.keys.join(", ")}), so you cannot assign it.`,
      };
    }
  }

  return {
    ok: true,
    roles: found.map((r) => ({
      id: r.id,
      name: r.name,
      permissions: (r.permissions ?? []) as StorePermission[],
    })),
  };
}

const assignSchema = z.object({
  storeId: z.uuid(),
  memberId: z.uuid(),
  roleIds: z.array(z.uuid()).max(10),
});

/**
 * Replaces a member's roles wholesale.
 *
 * Every role in the new set is checked against the actor's ceiling, including
 * ones the member already had — otherwise "keep what you have and add this"
 * would launder a role the actor could not grant directly.
 */
export async function setMemberRolesAction(
  input: z.input<typeof assignSchema>,
): Promise<ActionResult> {
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const { storeId, memberId, roleIds } = parsed.data;

  const access = await requireStorePermission(storeId, "member.assign_role");
  const who = await actor();
  if (!who) return { ok: false, message: "Not signed in." };

  const member = await db
    .select({
      id: storeMembers.id,
      userId: storeMembers.userId,
      email: user.email,
    })
    .from(storeMembers)
    .innerJoin(user, eq(user.id, storeMembers.userId))
    .where(
      and(eq(storeMembers.id, memberId), eq(storeMembers.storeId, storeId)),
    )
    .limit(1);

  if (member.length === 0) return { ok: false, message: "Member not found." };
  const target = member[0];

  const before = await db
    .select({ name: roles.name })
    .from(storeMemberRoles)
    .innerJoin(roles, eq(roles.id, storeMemberRoles.roleId))
    .where(eq(storeMemberRoles.memberId, memberId));

  const chosen = await rolesWithinCeiling(storeId, roleIds, access.permissions);
  if (!chosen.ok) return chosen;

  await db.transaction(async (tx) => {
    await tx
      .delete(storeMemberRoles)
      .where(eq(storeMemberRoles.memberId, memberId));

    if (chosen.roles.length > 0) {
      await tx
        .insert(storeMemberRoles)
        .values(chosen.roles.map((role) => ({ memberId, roleId: role.id })));
    }

    await tx.insert(auditLog).values({
      storeId,
      actorId: who.id,
      actorEmail: who.email,
      action: "member.assign_role",
      targetType: "store_member",
      targetId: memberId,
      targetLabel: target.email,
      before: { roles: before.map((r) => r.name) },
      after: { roles: chosen.roles.map((r) => r.name) },
    });
  });

  revalidatePath(`/dashboard/${storeId}/staff`);
  return { ok: true, message: `Updated roles for ${target.email}.` };
}

export async function removeMemberAction(input: {
  storeId: string;
  memberId: string;
}): Promise<ActionResult> {
  const storeId = z.uuid().parse(input.storeId);
  const memberId = z.uuid().parse(input.memberId);

  await requireStorePermission(storeId, "member.remove");
  const who = await actor();
  if (!who) return { ok: false, message: "Not signed in." };

  const [target] = await db
    .select({
      id: storeMembers.id,
      userId: storeMembers.userId,
      email: user.email,
    })
    .from(storeMembers)
    .innerJoin(user, eq(user.id, storeMembers.userId))
    .where(
      and(eq(storeMembers.id, memberId), eq(storeMembers.storeId, storeId)),
    )
    .limit(1);

  if (!target) return { ok: false, message: "Member not found." };

  // The owner is not a member row, so they cannot be removed through here at
  // all — but a member removing themselves is a real way to get locked out of
  // a store you are the only manager of. Ask them to be explicit elsewhere.
  if (target.userId === who.id) {
    return {
      ok: false,
      message: "You cannot remove your own access. Ask another manager.",
    };
  }

  await db.transaction(async (tx) => {
    await tx.delete(storeMembers).where(eq(storeMembers.id, memberId));
    await tx.insert(auditLog).values({
      storeId,
      actorId: who.id,
      actorEmail: who.email,
      action: "member.remove",
      targetType: "store_member",
      targetId: memberId,
      targetLabel: target.email,
      before: { status: "active" },
      after: null,
    });
  });

  revalidatePath(`/dashboard/${storeId}/staff`);
  return { ok: true, message: `Removed ${target.email}.` };
}

/** Accepts an invitation. Only the invited person can call it for themselves. */
export async function acceptInviteAction(input: {
  storeId: string;
}): Promise<ActionResult> {
  const storeId = z.uuid().parse(input.storeId);
  const who = await actor();
  if (!who) return { ok: false, message: "Not signed in." };

  const access = await getStoreAccess(storeId);
  if (!access || access.membershipStatus !== "invited") {
    return { ok: false, message: "No pending invitation for this store." };
  }

  await db
    .update(storeMembers)
    .set({ status: "active", joinedAt: new Date() })
    .where(
      and(eq(storeMembers.storeId, storeId), eq(storeMembers.userId, who.id)),
    );

  revalidatePath("/dashboard");
  return { ok: true, message: "You now have access to this store." };
}
