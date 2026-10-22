import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
// Relative, not "@/lib/env": this module is pulled in by lib/auth/index.ts,
// which the `auth` CLI loads through jiti without tsconfig path aliases.
import { env } from "../env";
import * as schema from "./schema/index";

/**
 * Turbopack HMR re-evaluates modules on every edit. Without caching the client
 * on globalThis, dev burns through Postgres connections until it refuses more.
 */
const globalForDb = globalThis as unknown as {
  __client?: ReturnType<typeof postgres>;
};

const client = globalForDb.__client ?? postgres(env.DATABASE_URL, { max: 10 });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__client = client;
}

export const db = drizzle(client, { schema, casing: "snake_case" });

export type Db = typeof db;
export { schema };

/**
 * Either the pool or a transaction.
 *
 * Read helpers that are safe to run inside a transaction take this instead of
 * `Db`, so a caller holding a lock can reuse them without the query escaping
 * to a second connection — which would read outside the lock and defeat it.
 */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];
