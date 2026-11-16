import { describe, expect, it } from "vitest";
import {
  PLATFORM_ROLES,
  STORE_ROLE_TEMPLATES,
} from "@/lib/db/seed/system-roles";
import {
  isPlatformPermission,
  isStorePermission,
  OWNER_ONLY_ACTIONS,
  PERMISSIONS,
  PLATFORM_PERMISSION_KEYS,
  permissionGroups,
  STORE_PERMISSION_KEYS,
} from "./permissions";

/**
 * The vocabulary itself, and the seeded roles that spell keys out by hand.
 *
 * access-rules.test.ts covers what the rules do with a permission set. This
 * covers the set: a key that exists in one place and not another grants
 * nothing at best, and at worst puts a role in the editor that no code path
 * ever checks.
 */

describe("the vocabulary", () => {
  it("has no duplicate keys", () => {
    const keys = PERMISSIONS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps store and platform keys disjoint", () => {
    const overlap = STORE_PERMISSION_KEYS.filter((key) =>
      isPlatformPermission(key),
    );
    expect(overlap).toEqual([]);
  });

  it("describes every key", () => {
    // A blank label renders an unlabelled checkbox in the role editor, which
    // is worse than a missing permission because it looks deliberate.
    for (const permission of PERMISSIONS) {
      expect(permission.label.length, permission.key).toBeGreaterThan(0);
      expect(permission.description.length, permission.key).toBeGreaterThan(0);
      expect(permission.group.length, permission.key).toBeGreaterThan(0);
    }
  });

  it("never expresses an owner-only action as a permission key", () => {
    // The whole point of OWNER_ONLY_ACTIONS is that they cannot be put in a
    // custom role. A key with the same name would make them delegable.
    for (const action of OWNER_ONLY_ACTIONS) {
      expect(isStorePermission(action), action).toBe(false);
      expect(isPlatformPermission(action), action).toBe(false);
    }
  });

  it("puts every key in exactly one group", () => {
    const groups = permissionGroups("store");
    const seen = groups.flatMap((g) => g.items.map((i) => i.key));
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(STORE_PERMISSION_KEYS.length);
  });
});

describe("media connection permissions", () => {
  it("are store keys, not platform ones", () => {
    // A seller connects their own Google account. Nothing about it belongs to
    // platform staff, who cannot be given it even by mistake.
    expect(isStorePermission("media.connection.view")).toBe(true);
    expect(isStorePermission("media.connection.manage")).toBe(true);
    expect(isPlatformPermission("media.connection.view")).toBe(false);
    expect(isPlatformPermission("media.connection.manage")).toBe(false);
  });

  it("appear in the role editor as their own group", () => {
    const media = permissionGroups("store").find((g) => g.name === "Media");
    expect(media?.items.map((i) => i.key)).toEqual([
      "media.connection.view",
      "media.connection.manage",
    ]);
  });

  it("are not marked sensitive", () => {
    // `sensitive` means "can change who can do what". Binding a Drive account
    // is powerful but it does not escalate anyone's privileges, and marking it
    // so would dilute the warning where it matters.
    const media = permissionGroups("store").find((g) => g.name === "Media");
    for (const item of media?.items ?? []) {
      expect(item.sensitive, item.key).toBeUndefined();
    }
  });
});

describe("seeded roles", () => {
  it("only reference keys that exist", () => {
    // `satisfies` catches this at compile time, but a key removed from the
    // vocabulary later leaves the template compiling against a stale type in
    // an editor while the seed silently writes a dead permission.
    for (const role of STORE_ROLE_TEMPLATES) {
      for (const key of role.permissions) {
        expect(isStorePermission(key), `${role.slug}: ${key}`).toBe(true);
      }
    }
    for (const role of PLATFORM_ROLES) {
      for (const key of role.permissions) {
        expect(isPlatformPermission(key), `${role.slug}: ${key}`).toBe(true);
      }
    }
  });

  it("never mix scopes within one role", () => {
    for (const role of STORE_ROLE_TEMPLATES) {
      expect(role.permissions.some(isPlatformPermission), role.slug).toBe(
        false,
      );
    }
    for (const role of PLATFORM_ROLES) {
      expect(role.permissions.some(isStorePermission), role.slug).toBe(false);
    }
  });

  it("give Super Admin the whole platform vocabulary", () => {
    const superAdmin = PLATFORM_ROLES.find((r) => r.slug === "super-admin");
    expect(superAdmin?.permissions.length).toBe(
      PLATFORM_PERMISSION_KEYS.length,
    );
  });

  it("keeps media access wherever store.profile.update already reached it", () => {
    // Media connections used to be gated on store.profile.update. Splitting
    // them out is only safe if the templates that had that key carry the new
    // ones too — otherwise the seed demotes existing staff on the next deploy.
    for (const role of STORE_ROLE_TEMPLATES) {
      if (!role.permissions.includes("store.profile.update")) continue;
      expect(role.permissions, role.slug).toContain("media.connection.view");
      expect(role.permissions, role.slug).toContain("media.connection.manage");
    }
  });

  it("does not hand media connections to roles that never had them", () => {
    // Fulfilment, Catalog and Finance could not reach the connections page
    // before. Adding a key is not an excuse to widen them.
    for (const slug of ["fulfilment", "catalog", "finance"]) {
      const role = STORE_ROLE_TEMPLATES.find((r) => r.slug === slug);
      expect(role, slug).toBeDefined();
      expect(role?.permissions, slug).not.toContain("media.connection.view");
      expect(role?.permissions, slug).not.toContain("media.connection.manage");
    }
  });

  it("has no Owner template", () => {
    // Ownership is stores.owner_id. A stored Owner role could be edited or
    // deleted, and locking an owner out of their own store is unrecoverable
    // without a database console.
    expect(STORE_ROLE_TEMPLATES.some((r) => r.slug === "owner")).toBe(false);
  });
});
