import { relations } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared";
import { stores } from "./stores";

/**
 * Seller-supplied Google capacity, as two independent pools.
 *
 * The split exists because the two things that run out are billed to different
 * owners and neither substitutes for the other:
 *
 *   - A Cloud PROJECT supplies YouTube Data API quota. It is 10,000 units a
 *     day and an upload costs 1,600, so a project is worth six videos a day
 *     until Google's compliance audit raises it. Quota is charged to the OAuth
 *     client, not to whoever's token authorised the call — four accounts on one
 *     project still share one bucket of six.
 *   - An ACCOUNT supplies the destination: the Drive that holds the bytes and
 *     the channel that receives the video. Storage is its 15 GB, per account.
 *
 * So a project running dry and an account filling up are different failures
 * with different remedies, and the seller saves several of each so the backend
 * can route around whichever broke.
 */

// ── Projects ───────────────────────────────────────────────────────────────

export const googleProjectState = pgEnum("google_project_state", [
  "active",
  /** Daily units spent. Clears by itself at the next Pacific midnight. */
  "quota_exhausted",
  /** Credentials rejected by Google. Needs the seller to fix it. */
  "invalid",
  /** Switched off by the seller. Never auto-selected. */
  "disabled",
]);

export const storeGoogleProjects = pgTable(
  "store_google_projects",
  {
    id: primaryId(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),

    /** Seller's own name for it. Cosmetic — they will have several. */
    label: text("label").notNull(),

    clientId: text("client_id").notNull(),
    /** AES-256-GCM, via lib/media/crypto.ts. Never stored raw. */
    clientSecretEnc: text("client_secret_enc").notNull(),

    /**
     * Google's default is 10,000/day. Stored rather than hardcoded because an
     * approved compliance audit raises it, and when that happens the only
     * correct change is this number.
     */
    dailyUnitLimit: integer("daily_unit_limit").notNull().default(10_000),

    /**
     * The ledger. Spending is recorded before the call, not after, so a crash
     * mid-upload over-counts rather than under-counts — over-counting wastes
     * capacity for a few hours, under-counting means discovering the ceiling
     * by burning 1,600 units on a call that was always going to 403.
     */
    unitsUsed: integer("units_used").notNull().default(0),
    /** When unitsUsed goes back to zero. Pacific midnight, per Google. */
    unitsResetAt: timestamp("units_reset_at", { withTimezone: true }).notNull(),

    state: googleProjectState("state").notNull().default("active"),
    /** Lower is tried first. */
    priority: integer("priority").notNull().default(0),

    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    lastError: text("last_error"),

    ...timestamps,
  },
  (t) => [
    // The same OAuth client twice would double-count one real budget.
    uniqueIndex("store_google_projects_store_client_key").on(
      t.storeId,
      t.clientId,
    ),
    index("store_google_projects_store_state_idx").on(t.storeId, t.state),
  ],
);

// ── Accounts ───────────────────────────────────────────────────────────────

export const googleAccountState = pgEnum("google_account_state", [
  "active",
  /** Drive is full. Only the seller can clear it. */
  "storage_full",
  /** Per-user throttle. Clears itself; see cooldownUntil. */
  "rate_limited",
  /** Access withdrawn at Google. Every grant on it is dead. */
  "revoked",
  "disabled",
]);

export const storeGoogleAccounts = pgTable(
  "store_google_accounts",
  {
    id: primaryId(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),

    email: text("email").notNull(),
    /** Google's `sub`. The email can change; this cannot. */
    googleUserId: text("google_user_id").notNull(),

    /**
     * From about.get(fields=storageQuota), refreshed on a schedule rather than
     * per upload. bigint in Postgres because 15 GB in bytes overflows int4 —
     * and a paid 2 TB account overflows it by a factor of a thousand.
     *
     * Read as `number` rather than `bigint`: the largest Drive plan is 30 TB,
     * which is 3.3e13 bytes against a safe integer ceiling of 9.0e15, so there
     * is no precision to lose and every caller avoids bigint's separate
     * arithmetic. `mode: "bigint"` would also need an ES2020 target, which
     * this project does not use.
     *
     * `limit` is absent for accounts with pooled/unlimited storage, which is
     * why it is nullable rather than zero.
     */
    storageLimitBytes: bigint("storage_limit_bytes", { mode: "number" }),
    storageUsageBytes: bigint("storage_usage_bytes", { mode: "number" }),
    storageCheckedAt: timestamp("storage_checked_at", { withTimezone: true }),

    state: googleAccountState("state").notNull().default("active"),
    /** Set when rate_limited. Not eligible again until this passes. */
    cooldownUntil: timestamp("cooldown_until", { withTimezone: true }),

    priority: integer("priority").notNull().default(0),

    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    lastError: text("last_error"),

    ...timestamps,
  },
  (t) => [
    uniqueIndex("store_google_accounts_store_user_key").on(
      t.storeId,
      t.googleUserId,
    ),
    index("store_google_accounts_store_state_idx").on(t.storeId, t.state),
  ],
);

// ── Grants: the pairing, and the thing an upload actually uses ─────────────

export const googleGrantState = pgEnum("google_grant_state", [
  "active",
  /** Refresh token rejected. Re-authorising this pair fixes it. */
  "invalid",
]);

/**
 * One account's authorisation, obtained through one project.
 *
 * This table is the whole reason the design works. A refresh token is issued
 * by a specific OAuth client, so a token obtained through project A cannot be
 * replayed against project B's credentials — Google returns invalid_grant. An
 * upload therefore needs a project and an account that have actually been
 * introduced to each other, and that pairing is a row here.
 *
 * The seller does not need every combination. Two projects and three accounts
 * is six possible grants, but four of them are enough to survive any single
 * failure on either axis.
 */
export const storeGoogleGrants = pgTable(
  "store_google_grants",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => storeGoogleProjects.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => storeGoogleAccounts.id, { onDelete: "cascade" }),

    /** AES-256-GCM. The credential everything else hangs off. */
    refreshTokenEnc: text("refresh_token_enc").notNull(),
    /** Space-separated, as Google returns them. */
    scopes: text("scopes").notNull().default(""),

    state: googleGrantState("state").notNull().default("active"),

    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    lastError: text("last_error"),

    ...timestamps,
  },
  (t) => [
    uniqueIndex("store_google_grants_pair_key").on(t.projectId, t.accountId),
    index("store_google_grants_account_idx").on(t.accountId),
  ],
);

// ── Relations ──────────────────────────────────────────────────────────────

export const storeGoogleProjectsRelations = relations(
  storeGoogleProjects,
  ({ one, many }) => ({
    store: one(stores, {
      fields: [storeGoogleProjects.storeId],
      references: [stores.id],
    }),
    grants: many(storeGoogleGrants),
  }),
);

export const storeGoogleAccountsRelations = relations(
  storeGoogleAccounts,
  ({ one, many }) => ({
    store: one(stores, {
      fields: [storeGoogleAccounts.storeId],
      references: [stores.id],
    }),
    grants: many(storeGoogleGrants),
  }),
);

export const storeGoogleGrantsRelations = relations(
  storeGoogleGrants,
  ({ one }) => ({
    project: one(storeGoogleProjects, {
      fields: [storeGoogleGrants.projectId],
      references: [storeGoogleProjects.id],
    }),
    account: one(storeGoogleAccounts, {
      fields: [storeGoogleGrants.accountId],
      references: [storeGoogleAccounts.id],
    }),
  }),
);
