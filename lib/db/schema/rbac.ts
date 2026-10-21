import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { Permission } from "@/lib/auth/permissions";
import { primaryId, timestamps } from "./_shared";
import { user } from "./auth";
import { stores } from "./stores";

export const roleScope = pgEnum("role_scope", ["store", "platform"]);

export const memberStatus = pgEnum("store_member_status", [
  "invited",
  "active",
  "suspended",
]);

/**
 * Roles are user-created bundles of permission keys.
 *
 * Permissions live in a JSONB array rather than a join table. A role is always
 * read and written as a whole — a permission check loads the array, and an
 * edit replaces it — so a join table would buy referential integrity we cannot
 * use anyway (the keys are defined in code, not in a table) at the cost of a
 * join on every authorisation check and a much noisier audit diff.
 *
 * `permissionsVersion` records the vocabulary version the array was written
 * against, so a future migration can find roles that reference a retired key.
 */
export const roles = pgTable(
  "roles",
  {
    id: primaryId(),

    scope: roleScope("scope").notNull(),

    /**
     * Null for platform roles and for the built-in store templates that every
     * store can clone. Set for a store's own custom roles.
     */
    storeId: uuid("store_id").references(() => stores.id, {
      onDelete: "cascade",
    }),

    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),

    permissions: jsonb("permissions")
      .$type<Permission[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),

    permissionsVersion: integer("permissions_version").notNull().default(1),

    /** Seeded and immutable. Customising one copies it first. */
    isSystem: boolean("is_system").notNull().default(false),

    ...timestamps,
  },
  (t) => [
    // Postgres treats NULLs as distinct, so a single unique(store_id, slug)
    // would let two platform roles share a slug. Two partial indexes instead.
    //
    // Scoped by `scope` as well: a store-scope "finance" template and a
    // platform-scope "finance" role both have a null store_id and are entirely
    // different things, so slug alone would wrongly collide them.
    uniqueIndex("roles_global_scope_slug_key")
      .on(t.scope, t.slug)
      .where(sql`${t.storeId} is null`),
    uniqueIndex("roles_store_slug_key")
      .on(t.storeId, t.slug)
      .where(sql`${t.storeId} is not null`),
    index("roles_store_idx").on(t.storeId),
    // Answers "which roles grant payout.view?" without scanning every role.
    index("roles_permissions_gin").using("gin", t.permissions),
  ],
);

/** A user's access to one store. Staff, not ownership. */
export const storeMembers = pgTable(
  "store_members",
  {
    id: primaryId(),

    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),

    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    status: memberStatus("status").notNull().default("invited"),

    invitedBy: text("invited_by").references(() => user.id, {
      onDelete: "set null",
    }),
    invitedAt: timestamp("invited_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    joinedAt: timestamp("joined_at", { withTimezone: true }),

    ...timestamps,
  },
  (t) => [
    uniqueIndex("store_members_store_user_key").on(t.storeId, t.userId),
    index("store_members_user_idx").on(t.userId),
    index("store_members_store_status_idx").on(t.storeId, t.status),
  ],
);

/**
 * Roles attach to a membership, not to a user. That is what lets someone be
 * Fulfilment on one store and Manager on another at the same time.
 */
export const storeMemberRoles = pgTable(
  "store_member_roles",
  {
    memberId: uuid("member_id")
      .notNull()
      .references(() => storeMembers.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
  },
  (t) => [
    primaryKey({ columns: [t.memberId, t.roleId] }),
    index("store_member_roles_role_idx").on(t.roleId),
  ],
);

export const userPlatformRoles = pgTable(
  "user_platform_roles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.roleId] }),
    index("user_platform_roles_role_idx").on(t.roleId),
  ],
);

/**
 * Append-only record of privileged actions.
 *
 * Same discipline as the money ledger: never updated, never deleted. When
 * someone asks "who gave this account refund access", this is the only thing
 * that can answer it.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: primaryId(),

    /** Null for platform-scope events. */
    storeId: uuid("store_id").references(() => stores.id, {
      onDelete: "cascade",
    }),

    /** Null when the actor is the system rather than a person. */
    actorId: text("actor_id").references(() => user.id, {
      onDelete: "set null",
    }),

    /** Snapshotted: the actor's name may change or the account may be deleted. */
    actorEmail: text("actor_email"),

    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    targetLabel: text("target_label"),

    /** Before/after of the changed fields only, not the whole row. */
    before: jsonb("before"),
    after: jsonb("after"),

    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("audit_log_store_created_idx").on(t.storeId, t.createdAt),
    index("audit_log_actor_idx").on(t.actorId),
    index("audit_log_action_idx").on(t.action),
  ],
);

export const rolesRelations = relations(roles, ({ one, many }) => ({
  store: one(stores, { fields: [roles.storeId], references: [stores.id] }),
  memberRoles: many(storeMemberRoles),
}));

export const storeMembersRelations = relations(
  storeMembers,
  ({ one, many }) => ({
    store: one(stores, {
      fields: [storeMembers.storeId],
      references: [stores.id],
    }),
    user: one(user, { fields: [storeMembers.userId], references: [user.id] }),
    roles: many(storeMemberRoles),
  }),
);

export const storeMemberRolesRelations = relations(
  storeMemberRoles,
  ({ one }) => ({
    member: one(storeMembers, {
      fields: [storeMemberRoles.memberId],
      references: [storeMembers.id],
    }),
    role: one(roles, {
      fields: [storeMemberRoles.roleId],
      references: [roles.id],
    }),
  }),
);
