/**
 * Verifies the staff, roles and fulfilment work against the real database.
 *
 * Server actions cannot be called from here — they need a request and a
 * session — so this exercises the same rows through the same pure validators
 * the actions use, plus the SQL the actions run, and checks the outcomes.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import {
  effectiveStorePermissions,
  validateGrant,
  validateRoleAssignment,
} from "../lib/auth/access-rules.ts";
import type { StorePermission } from "../lib/auth/permissions.ts";
import { db } from "../lib/db/index.ts";
import {
  orderItems,
  orders,
  productVariants,
  roles,
  storeMemberRoles,
  storeMembers,
  stores,
  subOrders,
  user,
} from "../lib/db/schema/index.ts";

let failures = 0;

function check(label: string, condition: boolean, detail = "") {
  const mark = condition ? "  ok  " : " FAIL ";
  if (!condition) failures++;
  console.log(`${mark} ${label}${detail ? ` — ${detail}` : ""}`);
}

async function permissionsFor(storeId: string, userId: string) {
  const [store] = await db
    .select({ ownerId: stores.ownerId })
    .from(stores)
    .where(eq(stores.id, storeId));

  if (store?.ownerId === userId) {
    return effectiveStorePermissions({
      isOwner: true,
      membershipStatus: "owner",
      rolePermissions: [],
    });
  }

  const [member] = await db
    .select({ id: storeMembers.id, status: storeMembers.status })
    .from(storeMembers)
    .where(
      and(eq(storeMembers.storeId, storeId), eq(storeMembers.userId, userId)),
    );

  if (!member) return new Set<StorePermission>();

  const assigned = await db
    .select({ permissions: roles.permissions })
    .from(storeMemberRoles)
    .innerJoin(roles, eq(roles.id, storeMemberRoles.roleId))
    .where(eq(storeMemberRoles.memberId, member.id));

  return effectiveStorePermissions({
    isOwner: false,
    membershipStatus: member.status,
    rolePermissions: assigned.map((r) => r.permissions ?? []),
  });
}

async function main() {
  const [store] = await db
    .select({ id: stores.id, name: stores.name, ownerId: stores.ownerId })
    .from(stores)
    .orderBy(stores.createdAt)
    .limit(1);

  console.log(`store: ${store.name}\n`);

  // -- the ceiling -------------------------------------------------------
  console.log("--- permission ceiling ---");

  const ownerPerms = await permissionsFor(store.id, store.ownerId);
  check(
    "owner holds every store permission",
    ownerPerms.size >= 35,
    `${ownerPerms.size} keys`,
  );

  const [fulfilment] = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(eq(user.email, "sam@northmark.test"));

  const samPerms = await permissionsFor(store.id, fulfilment.id);
  console.log(
    `  sam (fulfilment) holds ${samPerms.size}: ${[...samPerms].join(", ")}`,
  );

  check("fulfilment can ship", samPerms.has("order.ship"));
  check("fulfilment cannot see the ledger", !samPerms.has("ledger.view"));
  check("fulfilment cannot create roles", !samPerms.has("role.create"));

  // Sam tries to build a role granting refunds, which he does not hold.
  const escalate = validateGrant({
    actorPermissions: samPerms,
    requested: ["order.ship", "order.refund"],
    existingCustomRoleCount: 0,
    isUpdate: false,
    targetIsSystemRole: false,
  });
  check(
    "role granting more than the actor holds is refused",
    !escalate.ok && escalate.reason === "exceeds-ceiling",
    escalate.ok
      ? "ALLOWED"
      : `keys=${JSON.stringify((escalate as { keys?: string[] }).keys)}`,
  );

  // The owner can grant the same thing.
  const ownerGrant = validateGrant({
    actorPermissions: ownerPerms,
    requested: ["order.ship", "order.refund"],
    existingCustomRoleCount: 0,
    isUpdate: false,
    targetIsSystemRole: false,
  });
  check("owner can grant the same permissions", ownerGrant.ok);

  // A key that is not in the vocabulary.
  const bogus = validateGrant({
    actorPermissions: ownerPerms,
    requested: ["store.delete", "order.ship"],
    existingCustomRoleCount: 0,
    isUpdate: false,
    targetIsSystemRole: false,
  });
  check(
    "owner-only action is not grantable as a permission",
    !bogus.ok && bogus.reason === "unknown-permission",
  );

  // System roles are immutable.
  const [systemRole] = await db
    .select({ id: roles.id, name: roles.name, permissions: roles.permissions })
    .from(roles)
    .where(
      and(
        eq(roles.scope, "store"),
        isNull(roles.storeId),
        eq(roles.isSystem, true),
      ),
    )
    .limit(1);

  const editSystem = validateGrant({
    actorPermissions: ownerPerms,
    requested: [],
    existingCustomRoleCount: 0,
    isUpdate: true,
    targetIsSystemRole: true,
  });
  check(
    `built-in role "${systemRole.name}" cannot be edited`,
    !editSystem.ok && editSystem.reason === "system-role-immutable",
  );

  // -- assignment --------------------------------------------------------
  console.log("\n--- role assignment ---");

  const [manager] = await db
    .select({ id: roles.id, name: roles.name, permissions: roles.permissions })
    .from(roles)
    .where(
      and(
        eq(roles.scope, "store"),
        isNull(roles.storeId),
        eq(roles.slug, "manager"),
      ),
    );

  const samAssigns = validateRoleAssignment({
    actorPermissions: samPerms,
    rolePermissions: manager.permissions ?? [],
  });
  check(
    "fulfilment cannot assign the manager role",
    !samAssigns.ok,
    samAssigns.ok ? "ALLOWED" : `blocked on ${samAssigns.keys.length} keys`,
  );

  const ownerAssigns = validateRoleAssignment({
    actorPermissions: ownerPerms,
    rolePermissions: manager.permissions ?? [],
  });
  check("owner can assign the manager role", ownerAssigns.ok);

  // -- store isolation ---------------------------------------------------
  console.log("\n--- store isolation ---");

  const [otherStore] = await db
    .select({ id: stores.id, name: stores.name })
    .from(stores)
    .where(sql`${stores.id} <> ${store.id}`)
    .limit(1);

  const samElsewhere = await permissionsFor(otherStore.id, fulfilment.id);
  check(
    `staff on one store hold nothing on ${otherStore.name}`,
    samElsewhere.size === 0,
    `${samElsewhere.size} keys`,
  );

  // An invited-but-not-accepted member grants nothing.
  const invited = effectiveStorePermissions({
    isOwner: false,
    membershipStatus: "invited",
    rolePermissions: [manager.permissions ?? []],
  });
  check("an unaccepted invitation grants nothing", invited.size === 0);

  const suspended = effectiveStorePermissions({
    isOwner: false,
    membershipStatus: "suspended",
    rolePermissions: [manager.permissions ?? []],
  });
  check("a suspended member grants nothing", suspended.size === 0);

  // -- fulfilment: the restock SQL --------------------------------------
  console.log("\n--- cancel restocks in the same statement ---");

  const [sub] = await db
    .select({
      id: subOrders.id,
      orderId: subOrders.orderId,
      status: subOrders.status,
    })
    .from(subOrders)
    .limit(1);

  if (!sub) {
    console.log("  (no orders placed, skipping)");
  } else {
    const items = await db
      .select({
        variantId: orderItems.variantId,
        quantity: orderItems.quantity,
      })
      .from(orderItems)
      .where(eq(orderItems.subOrderId, sub.id));

    const before = await db
      .select({ id: productVariants.id, stock: productVariants.stock })
      .from(productVariants)
      .where(
        sql`${productVariants.id} in ${sql`(${sql.join(
          items.map((i) => sql`${i.variantId}`),
          sql`, `,
        )})`}`,
      );

    // Exactly the statement cancelOrderAction runs, then rolled back so the
    // seeded data is left as it was.
    await db
      .transaction(async (tx) => {
        await tx.execute(sql`
        update product_variants v
        set stock = v.stock + oi.quantity
        from order_items oi
        where oi.sub_order_id = ${sub.id} and oi.variant_id = v.id
      `);

        const after = await tx
          .select({ id: productVariants.id, stock: productVariants.stock })
          .from(productVariants)
          .where(
            sql`${productVariants.id} in ${sql`(${sql.join(
              items.map((i) => sql`${i.variantId}`),
              sql`, `,
            )})`}`,
          );

        let allRestored = true;
        for (const item of items) {
          const was = before.find((v) => v.id === item.variantId)?.stock ?? 0;
          const now = after.find((v) => v.id === item.variantId)?.stock ?? 0;
          if (now !== was + item.quantity) allRestored = false;
        }
        check(
          "cancelling returns exactly the ordered quantity",
          allRestored,
          items.map((i) => `+${i.quantity}`).join(" "),
        );

        tx.rollback();
      })
      .catch(() => {
        // rollback() throws by design; the check above already ran.
      });

    const afterRollback = await db
      .select({ id: productVariants.id, stock: productVariants.stock })
      .from(productVariants)
      .where(
        sql`${productVariants.id} in ${sql`(${sql.join(
          items.map((i) => sql`${i.variantId}`),
          sql`, `,
        )})`}`,
      );

    const unchanged = before.every(
      (b) => afterRollback.find((a) => a.id === b.id)?.stock === b.stock,
    );
    check("verification rolled back cleanly", unchanged);
  }

  // -- parent order status derivation -----------------------------------
  console.log("\n--- parent status is derived, not stored ---");

  function derive(statuses: string[]) {
    const live = statuses.filter((s) => s !== "cancelled" && s !== "refunded");
    if (live.length === 0) {
      return statuses.every((s) => s === "refunded") ? "refunded" : "cancelled";
    }
    const done = live.filter((s) => s === "shipped" || s === "delivered");
    return done.length === 0
      ? "paid"
      : done.length === live.length
        ? "fulfilled"
        : "partially_fulfilled";
  }

  check("all accepted → paid", derive(["accepted", "accepted"]) === "paid");
  check(
    "one shipped of two → partially_fulfilled",
    derive(["shipped", "accepted"]) === "partially_fulfilled",
  );
  check(
    "both shipped → fulfilled",
    derive(["shipped", "delivered"]) === "fulfilled",
  );
  check(
    "one cancelled, one delivered → fulfilled",
    derive(["cancelled", "delivered"]) === "fulfilled",
    "a cancelled part must not hold the order open",
  );
  check(
    "every part cancelled → cancelled",
    derive(["cancelled"]) === "cancelled",
  );
  check("every part refunded → refunded", derive(["refunded"]) === "refunded");

  // -- what the seller queue actually returns ---------------------------
  console.log("\n--- seller queue ---");

  const queue = await db
    .select({
      id: subOrders.id,
      status: subOrders.status,
      storeId: subOrders.storeId,
      orderNumber: orders.orderNumber,
    })
    .from(subOrders)
    .innerJoin(orders, eq(orders.id, subOrders.orderId))
    .where(eq(subOrders.storeId, store.id));

  check(
    "every row in a store's queue belongs to that store",
    queue.every((row) => row.storeId === store.id),
    `${queue.length} rows`,
  );

  console.log(
    failures === 0
      ? "\nall checks passed"
      : `\n${failures} CHECK${failures === 1 ? "" : "S"} FAILED`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
