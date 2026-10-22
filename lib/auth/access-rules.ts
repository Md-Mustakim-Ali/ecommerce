import {
  isPlatformPermission,
  isStorePermission,
  MAX_CUSTOM_ROLES_PER_STORE,
  type Permission,
  type PlatformPermission,
  STORE_PERMISSION_KEYS,
  type StorePermission,
} from "./permissions";

/**
 * Pure authorisation logic, deliberately separated from database access.
 *
 * This is the security core: it decides what somebody can do and what they are
 * allowed to grant. Keeping it free of I/O means it can be tested exhaustively
 * rather than through fixtures, which for privilege escalation is the
 * difference between "probably fine" and "checked".
 */

export type StoreAccess = {
  storeId: string;
  userId: string;
  /** True when this user is `stores.owner_id`. */
  isOwner: boolean;
  /** Union of the permissions from every role on this membership. */
  permissions: ReadonlySet<StorePermission>;
  membershipStatus: "owner" | "active" | "invited" | "suspended" | "none";
};

/**
 * The owner implicitly holds every store permission, always.
 *
 * Not stored as a role: a stored grant can be edited or deleted, and an owner
 * locked out of their own store is a support ticket that cannot be resolved
 * without a database console.
 */
export function effectiveStorePermissions(input: {
  isOwner: boolean;
  membershipStatus: StoreAccess["membershipStatus"];
  rolePermissions: readonly Permission[][];
}): ReadonlySet<StorePermission> {
  if (input.isOwner) return new Set(STORE_PERMISSION_KEYS);

  // An invitation that has not been accepted, or a suspended member, grants
  // nothing. Checked here rather than at the query so the rule is visible.
  if (input.membershipStatus !== "active") return new Set();

  const granted = new Set<StorePermission>();
  for (const role of input.rolePermissions) {
    for (const key of role) {
      // A key retired from the vocabulary but still sitting in an old role must
      // not grant anything.
      if (isStorePermission(key)) granted.add(key);
    }
  }
  return granted;
}

export function can(
  access: Pick<StoreAccess, "permissions">,
  permission: StorePermission,
): boolean {
  return access.permissions.has(permission);
}

export function canAll(
  access: Pick<StoreAccess, "permissions">,
  permissions: readonly StorePermission[],
): boolean {
  return permissions.every((p) => access.permissions.has(p));
}

// ---------------------------------------------------------------------------
// Granting
// ---------------------------------------------------------------------------

export type GrantRejection =
  | { ok: false; reason: "unknown-permission"; keys: string[] }
  | { ok: false; reason: "exceeds-ceiling"; keys: StorePermission[] }
  | { ok: false; reason: "role-limit-reached"; limit: number }
  | { ok: false; reason: "system-role-immutable" };

export type GrantResult =
  | { ok: true; permissions: StorePermission[] }
  | GrantRejection;

/**
 * The permission ceiling.
 *
 * Nobody can create or edit a role that grants more than they themselves hold.
 * Without this, any account with `role.create` is a full store takeover: make a
 * role with every permission, assign it to yourself, done.
 *
 * This is also the self-escalation guard. An actor editing a role they are
 * assigned to is still bounded by what they currently hold, so they cannot add
 * a permission to their own role to acquire it.
 *
 * Must be called server-side on every role create and update. A UI that hides
 * unavailable checkboxes is a courtesy, not a control.
 */
export function validateGrant(input: {
  /** What the actor currently holds. Owners hold everything. */
  actorPermissions: ReadonlySet<StorePermission>;
  /** Raw keys off the wire — untrusted, possibly arbitrary strings. */
  requested: readonly string[];
  /** Custom (non-system) roles already defined for this store. */
  existingCustomRoleCount: number;
  /** True when editing rather than creating; the limit only applies to creates. */
  isUpdate: boolean;
  /** System roles are seeded and immutable; customising one copies it first. */
  targetIsSystemRole: boolean;
}): GrantResult {
  if (input.targetIsSystemRole) {
    return { ok: false, reason: "system-role-immutable" };
  }

  if (
    !input.isUpdate &&
    input.existingCustomRoleCount >= MAX_CUSTOM_ROLES_PER_STORE
  ) {
    return {
      ok: false,
      reason: "role-limit-reached",
      limit: MAX_CUSTOM_ROLES_PER_STORE,
    };
  }

  // Reject anything outside the versioned vocabulary before comparing against
  // the ceiling, so permission sprawl cannot enter through this door.
  const unknown = input.requested.filter((key) => !isStorePermission(key));
  if (unknown.length > 0) {
    return { ok: false, reason: "unknown-permission", keys: unknown };
  }

  const requested = [...new Set(input.requested as StorePermission[])];

  const exceeded = requested.filter((key) => !input.actorPermissions.has(key));
  if (exceeded.length > 0) {
    return { ok: false, reason: "exceeds-ceiling", keys: exceeded };
  }

  return { ok: true, permissions: requested };
}

/**
 * Assigning somebody to an existing role is bounded by the same ceiling.
 *
 * `member.assign_role` is deliberately a separate permission from `role.create`
 * — being able to put a person into a role is a much smaller power than being
 * able to define what that role can do — but on its own it would still be an
 * escalation path: assign yourself to the Owner-equivalent role and you have
 * everything. So the role's permissions must also sit within what the assigner
 * holds.
 */
export function validateRoleAssignment(input: {
  actorPermissions: ReadonlySet<StorePermission>;
  rolePermissions: readonly Permission[];
}):
  | { ok: true }
  | { ok: false; reason: "exceeds-ceiling"; keys: StorePermission[] } {
  const exceeded = input.rolePermissions.filter(
    (key): key is StorePermission =>
      isStorePermission(key) && !input.actorPermissions.has(key),
  );

  if (exceeded.length > 0) {
    return { ok: false, reason: "exceeds-ceiling", keys: exceeded };
  }
  return { ok: true };
}

/**
 * Before/after diff for the audit log.
 *
 * Records only what changed. A full snapshot of both permission arrays makes
 * the log unreadable at exactly the moment somebody is trying to read it.
 */
export function permissionDiff(
  before: readonly Permission[],
  after: readonly Permission[],
): { added: Permission[]; removed: Permission[] } {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((key) => !beforeSet.has(key)).sort(),
    removed: before.filter((key) => !afterSet.has(key)).sort(),
  };
}

// ---------------------------------------------------------------------------
// Platform scope
// ---------------------------------------------------------------------------

/**
 * The same ceiling, one level up.
 *
 * Platform roles have no owner to fall back on — there is no equivalent of
 * `stores.owner_id` that implicitly holds everything — so the only thing
 * stopping a staff member from granting themselves more than they have is this
 * check. Getting it wrong is a full platform takeover rather than one store.
 *
 * Deliberately a separate function from validateGrant rather than a generic
 * one. The two vocabularies are different types, and a generic version would
 * have to widen to `string` to accept both, which is exactly the check being
 * performed.
 */
export function validatePlatformGrant(input: {
  actorPermissions: ReadonlySet<PlatformPermission>;
  requested: readonly string[];
  targetIsSystemRole: boolean;
}):
  | { ok: true; permissions: PlatformPermission[] }
  | { ok: false; reason: "unknown-permission"; keys: string[] }
  | { ok: false; reason: "exceeds-ceiling"; keys: PlatformPermission[] }
  | { ok: false; reason: "system-role-immutable" } {
  if (input.targetIsSystemRole) {
    return { ok: false, reason: "system-role-immutable" };
  }

  const unknown = input.requested.filter((key) => !isPlatformPermission(key));
  if (unknown.length > 0) {
    return { ok: false, reason: "unknown-permission", keys: unknown };
  }

  const requested = [...new Set(input.requested as PlatformPermission[])];
  const exceeded = requested.filter((key) => !input.actorPermissions.has(key));
  if (exceeded.length > 0) {
    return { ok: false, reason: "exceeds-ceiling", keys: exceeded };
  }

  return { ok: true, permissions: requested };
}

/**
 * Assigning a platform role is bounded by the same ceiling.
 *
 * Without this, `platform.role.manage` alone would be an escalation path:
 * assign yourself to the Super Admin role and you hold everything.
 */
export function validatePlatformAssignment(input: {
  actorPermissions: ReadonlySet<PlatformPermission>;
  rolePermissions: readonly Permission[];
}):
  | { ok: true }
  | { ok: false; reason: "exceeds-ceiling"; keys: PlatformPermission[] } {
  const exceeded = input.rolePermissions.filter(
    (key): key is PlatformPermission =>
      isPlatformPermission(key) && !input.actorPermissions.has(key),
  );

  if (exceeded.length > 0) {
    return { ok: false, reason: "exceeds-ceiling", keys: exceeded };
  }
  return { ok: true };
}
