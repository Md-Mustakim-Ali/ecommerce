import { describe, expect, it } from "vitest";
import {
  can,
  effectiveStorePermissions,
  permissionDiff,
  validateGrant,
  validatePlatformAssignment,
  validatePlatformGrant,
  validateRoleAssignment,
} from "./access-rules";
import {
  MAX_CUSTOM_ROLES_PER_STORE,
  PLATFORM_PERMISSION_KEYS,
  type PlatformPermission,
  STORE_PERMISSION_KEYS,
  type StorePermission,
} from "./permissions";

const set = (...keys: StorePermission[]) => new Set(keys);

const baseGrant = {
  existingCustomRoleCount: 0,
  isUpdate: false,
  targetIsSystemRole: false,
};

describe("effectiveStorePermissions", () => {
  it("gives the owner every store permission", () => {
    const permissions = effectiveStorePermissions({
      isOwner: true,
      membershipStatus: "owner",
      rolePermissions: [],
    });
    expect(permissions.size).toBe(STORE_PERMISSION_KEYS.length);
    expect(permissions.has("role.create")).toBe(true);
    expect(permissions.has("payout.view")).toBe(true);
  });

  it("unions permissions across every role on the membership", () => {
    const permissions = effectiveStorePermissions({
      isOwner: false,
      membershipStatus: "active",
      rolePermissions: [
        ["order.view", "order.ship"],
        ["order.view", "product.view"],
      ],
    });
    expect([...permissions].sort()).toEqual([
      "order.ship",
      "order.view",
      "product.view",
    ]);
  });

  it("grants nothing to an invited member who has not accepted", () => {
    const permissions = effectiveStorePermissions({
      isOwner: false,
      membershipStatus: "invited",
      rolePermissions: [["order.view"]],
    });
    expect(permissions.size).toBe(0);
  });

  it("grants nothing to a suspended member", () => {
    // The roles are still attached; suspension has to override them or
    // suspending somebody would do nothing at all.
    const permissions = effectiveStorePermissions({
      isOwner: false,
      membershipStatus: "suspended",
      rolePermissions: [["order.view", "payout.view"]],
    });
    expect(permissions.size).toBe(0);
  });

  it("ignores keys that are no longer in the vocabulary", () => {
    const permissions = effectiveStorePermissions({
      isOwner: false,
      membershipStatus: "active",
      rolePermissions: [
        ["order.view", "product.superdelete" as StorePermission],
      ],
    });
    expect([...permissions]).toEqual(["order.view"]);
  });

  it("does not treat a platform permission as a store permission", () => {
    const permissions = effectiveStorePermissions({
      isOwner: false,
      membershipStatus: "active",
      rolePermissions: [["platform.payout.initiate", "order.view"]],
    });
    expect(permissions.has("platform.payout.initiate" as StorePermission)).toBe(
      false,
    );
    expect(permissions.has("order.view")).toBe(true);
  });
});

describe("validateGrant — the permission ceiling", () => {
  it("allows granting a subset of what the actor holds", () => {
    const result = validateGrant({
      ...baseGrant,
      actorPermissions: set("order.view", "order.ship", "product.view"),
      requested: ["order.view", "order.ship"],
    });
    expect(result).toEqual({
      ok: true,
      permissions: ["order.view", "order.ship"],
    });
  });

  it("blocks granting a permission the actor does not hold", () => {
    // The core escalation: someone with role.create must not be able to mint a
    // role that can move money.
    const result = validateGrant({
      ...baseGrant,
      actorPermissions: set("role.create", "order.view"),
      requested: ["order.view", "payout.view"],
    });
    expect(result).toEqual({
      ok: false,
      reason: "exceeds-ceiling",
      keys: ["payout.view"],
    });
  });

  it("blocks self-escalation through editing a role the actor is in", () => {
    // Actor holds exactly what their role grants. Adding anything to that role
    // is by definition outside their ceiling, so the same check covers it.
    const held = set("order.view", "order.ship");
    const result = validateGrant({
      ...baseGrant,
      isUpdate: true,
      actorPermissions: held,
      requested: ["order.view", "order.ship", "role.create"],
    });
    expect(result).toEqual({
      ok: false,
      reason: "exceeds-ceiling",
      keys: ["role.create"],
    });
  });

  it("lets an owner grant anything", () => {
    const result = validateGrant({
      ...baseGrant,
      actorPermissions: new Set(STORE_PERMISSION_KEYS),
      requested: [...STORE_PERMISSION_KEYS],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects keys outside the vocabulary before checking the ceiling", () => {
    // Ordering matters: an arbitrary string must never reach storage, even if
    // the actor happens to be an owner who would pass the ceiling check.
    const result = validateGrant({
      ...baseGrant,
      actorPermissions: new Set(STORE_PERMISSION_KEYS),
      requested: ["order.view", "store.delete", "*"],
    });
    expect(result).toEqual({
      ok: false,
      reason: "unknown-permission",
      keys: ["store.delete", "*"],
    });
  });

  it("rejects owner-only actions dressed up as permission keys", () => {
    // OWNER_ONLY_ACTIONS are deliberately not in the vocabulary, so they can
    // never be smuggled into a custom role.
    const result = validateGrant({
      ...baseGrant,
      actorPermissions: new Set(STORE_PERMISSION_KEYS),
      requested: ["store.transfer_ownership"],
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("unknown-permission");
  });

  it("refuses to edit a system role", () => {
    const result = validateGrant({
      ...baseGrant,
      targetIsSystemRole: true,
      isUpdate: true,
      actorPermissions: new Set(STORE_PERMISSION_KEYS),
      requested: ["order.view"],
    });
    expect(result).toEqual({ ok: false, reason: "system-role-immutable" });
  });

  it("enforces the custom role cap on create but not on update", () => {
    const actorPermissions = new Set(STORE_PERMISSION_KEYS);

    expect(
      validateGrant({
        ...baseGrant,
        actorPermissions,
        requested: ["order.view"],
        existingCustomRoleCount: MAX_CUSTOM_ROLES_PER_STORE,
      }),
    ).toEqual({
      ok: false,
      reason: "role-limit-reached",
      limit: MAX_CUSTOM_ROLES_PER_STORE,
    });

    // Editing an existing role does not add one, so the cap must not block it.
    expect(
      validateGrant({
        ...baseGrant,
        isUpdate: true,
        actorPermissions,
        requested: ["order.view"],
        existingCustomRoleCount: MAX_CUSTOM_ROLES_PER_STORE,
      }).ok,
    ).toBe(true);
  });

  it("deduplicates repeated keys", () => {
    const result = validateGrant({
      ...baseGrant,
      actorPermissions: set("order.view"),
      requested: ["order.view", "order.view"],
    });
    expect(result).toEqual({ ok: true, permissions: ["order.view"] });
  });

  it("accepts an empty permission set", () => {
    const result = validateGrant({
      ...baseGrant,
      actorPermissions: set("order.view"),
      requested: [],
    });
    expect(result).toEqual({ ok: true, permissions: [] });
  });
});

describe("validateRoleAssignment", () => {
  it("blocks assigning somebody to a role stronger than the assigner", () => {
    // member.assign_role on its own would otherwise be a takeover: assign
    // yourself to the strongest role that exists.
    const result = validateRoleAssignment({
      actorPermissions: set("member.assign_role", "order.view"),
      rolePermissions: ["order.view", "payout.view"],
    });
    expect(result).toEqual({
      ok: false,
      reason: "exceeds-ceiling",
      keys: ["payout.view"],
    });
  });

  it("allows assigning a role within the assigner's own permissions", () => {
    const result = validateRoleAssignment({
      actorPermissions: set("member.assign_role", "order.view", "order.ship"),
      rolePermissions: ["order.view"],
    });
    expect(result).toEqual({ ok: true });
  });
});

describe("permissionDiff", () => {
  it("reports only what changed", () => {
    expect(
      permissionDiff(
        ["order.view", "order.ship"],
        ["order.view", "payout.view"],
      ),
    ).toEqual({ added: ["payout.view"], removed: ["order.ship"] });
  });

  it("reports nothing when the sets match", () => {
    expect(permissionDiff(["order.view"], ["order.view"])).toEqual({
      added: [],
      removed: [],
    });
  });
});

describe("can", () => {
  it("is a plain membership check", () => {
    const access = { permissions: set("order.view") };
    expect(can(access, "order.view")).toBe(true);
    expect(can(access, "order.ship")).toBe(false);
  });
});

describe("the platform ceiling", () => {
  const all = new Set(PLATFORM_PERMISSION_KEYS);
  const limited = new Set<PlatformPermission>([
    "platform.store.view",
    "platform.brand.review",
  ]);

  it("lets somebody grant what they hold", () => {
    const result = validatePlatformGrant({
      actorPermissions: limited,
      requested: ["platform.store.view"],
      targetIsSystemRole: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.permissions).toEqual(["platform.store.view"]);
  });

  it("refuses anything above the ceiling", () => {
    const result = validatePlatformGrant({
      actorPermissions: limited,
      requested: ["platform.store.view", "platform.payout.initiate"],
      targetIsSystemRole: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "exceeds-ceiling") {
      expect(result.keys).toEqual(["platform.payout.initiate"]);
    } else {
      throw new Error("expected exceeds-ceiling");
    }
  });

  it("refuses a key outside the vocabulary", () => {
    const result = validatePlatformGrant({
      actorPermissions: all,
      // A store key is not a platform key, however real it looks.
      requested: ["order.ship", "platform.store.view"],
      targetIsSystemRole: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "unknown-permission") {
      expect(result.keys).toEqual(["order.ship"]);
    } else {
      throw new Error("expected unknown-permission");
    }
  });

  it("refuses to edit a system role", () => {
    const result = validatePlatformGrant({
      actorPermissions: all,
      requested: [],
      targetIsSystemRole: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("system-role-immutable");
  });

  it("stops self-escalation through assignment", () => {
    // The classic hole: platform.role.manage alone would otherwise let
    // somebody put themselves in the Super Admin role.
    const result = validatePlatformAssignment({
      actorPermissions: limited,
      rolePermissions: [...PLATFORM_PERMISSION_KEYS],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.keys.length).toBeGreaterThan(0);
  });

  it("allows an assignment fully inside the ceiling", () => {
    expect(
      validatePlatformAssignment({
        actorPermissions: all,
        rolePermissions: ["platform.store.view", "platform.payout.initiate"],
      }).ok,
    ).toBe(true);
  });

  it("ignores store keys when checking an assignment", () => {
    // A malformed role carrying a store key must not be treated as granting
    // platform power, in either direction.
    expect(
      validatePlatformAssignment({
        actorPermissions: limited,
        rolePermissions: ["order.ship", "platform.store.view"],
      }).ok,
    ).toBe(true);
  });

  it("deduplicates a repeated request", () => {
    const result = validatePlatformGrant({
      actorPermissions: all,
      requested: ["platform.store.view", "platform.store.view"],
      targetIsSystemRole: false,
    });
    if (result.ok) expect(result.permissions).toHaveLength(1);
  });
});
