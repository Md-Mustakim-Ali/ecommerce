/**
 * Verifies the owner-only boundary.
 *
 * The point of these four actions is that no permission grants them. So the
 * test that matters is not "can the owner do it" but "can somebody holding
 * every store permission still not do it" — because that is exactly what a
 * fully-loaded custom role produces, and a permission check instead of an
 * identity check would pass.
 */

import { and, eq } from "drizzle-orm";
import {
  effectiveStorePermissions,
  validateGrant,
} from "../lib/auth/access-rules.ts";
import {
  OWNER_ONLY_ACTIONS,
  STORE_PERMISSION_KEYS,
} from "../lib/auth/permissions.ts";
import { db } from "../lib/db/index.ts";
import {
  roles,
  storeMemberRoles,
  storeMembers,
  stores,
  user,
} from "../lib/db/schema/index.ts";

let failures = 0;
function check(label: string, condition: boolean, detail = "") {
  if (!condition) failures++;
  console.log(
    `${condition ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`,
  );
}

async function main() {
  const [store] = await db
    .select({ id: stores.id, name: stores.name, ownerId: stores.ownerId })
    .from(stores)
    .orderBy(stores.createdAt)
    .limit(1);

  console.log(`store: ${store.name}\n--- the boundary ---`);

  // The owner holds everything.
  const ownerPermissions = effectiveStorePermissions({
    isOwner: true,
    membershipStatus: "owner",
    rolePermissions: [],
  });
  check(
    "the owner holds every store permission",
    ownerPermissions.size === STORE_PERMISSION_KEYS.length,
    `${ownerPermissions.size} of ${STORE_PERMISSION_KEYS.length}`,
  );

  // A staff member in a role granting literally every permission.
  const maxedStaff = effectiveStorePermissions({
    isOwner: false,
    membershipStatus: "active",
    rolePermissions: [[...STORE_PERMISSION_KEYS]],
  });
  check(
    "a maxed-out role also holds every store permission",
    maxedStaff.size === ownerPermissions.size,
    `${maxedStaff.size} keys`,
  );

  // And yet none of the owner-only actions is among them, so a permission
  // check could never distinguish the two.
  const leaked = OWNER_ONLY_ACTIONS.filter((action) =>
    (maxedStaff as ReadonlySet<string>).has(action),
  );
  check(
    "none of the owner-only actions is a permission anybody can hold",
    leaked.length === 0,
    leaked.length ? `LEAKED: ${leaked.join(", ")}` : "all four unreachable",
  );

  // They cannot be smuggled into a custom role either.
  for (const action of OWNER_ONLY_ACTIONS) {
    const grant = validateGrant({
      actorPermissions: ownerPermissions,
      requested: [action],
      existingCustomRoleCount: 0,
      isUpdate: false,
      targetIsSystemRole: false,
    });
    check(
      `"${action}" cannot be put in a role`,
      !grant.ok && grant.reason === "unknown-permission",
    );
  }

  console.log("\n--- against real rows ---");

  // The seeded Manager, who has the most of any staff role.
  const [manager] = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(eq(user.email, "petra@northmark.test"));

  const [member] = await db
    .select({ id: storeMembers.id, status: storeMembers.status })
    .from(storeMembers)
    .where(
      and(
        eq(storeMembers.storeId, store.id),
        eq(storeMembers.userId, manager.id),
      ),
    );

  const assigned = await db
    .select({ permissions: roles.permissions })
    .from(storeMemberRoles)
    .innerJoin(roles, eq(roles.id, storeMemberRoles.roleId))
    .where(eq(storeMemberRoles.memberId, member.id));

  const managerPermissions = effectiveStorePermissions({
    isOwner: false,
    membershipStatus: member.status,
    rolePermissions: assigned.map((r) => r.permissions ?? []),
  });

  check(
    "the seeded Manager is not the owner",
    manager.id !== store.ownerId,
    manager.email,
  );
  check(
    "and holds a lot of permissions",
    managerPermissions.size > 20,
    `${managerPermissions.size} keys`,
  );
  check(
    "but still none of the owner-only actions",
    OWNER_ONLY_ACTIONS.every(
      (a) => !(managerPermissions as ReadonlySet<string>).has(a),
    ),
  );

  console.log(
    failures === 0 ? "\nall checks passed" : `\n${failures} CHECK(S) FAILED`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
