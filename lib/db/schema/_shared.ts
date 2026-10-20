import { sql } from "drizzle-orm";
import { timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * uuidv7() is native in Postgres 18. Timestamp-ordered, so inserts land at the
 * end of the index instead of scattering across it the way uuid_generate_v4()
 * does. On a table like order_items that matters a lot.
 */
export const primaryId = () => uuid("id").primaryKey().default(sql`uuidv7()`);

/** A uuidv7 default for non-primary-key columns. */
export const uuidv7Default = sql`uuidv7()`;

export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/**
 * Better Auth owns the `user` table and gives it a text id, not a uuid. Every
 * foreign key pointing at a user therefore has to be text. Centralised here so
 * the mismatch is stated once rather than rediscovered per table.
 */
export const USER_ID_TYPE = "text" as const;
