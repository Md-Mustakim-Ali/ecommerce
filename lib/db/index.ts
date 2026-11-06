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

/**
 * Serverless deployments get one connection per instance, not ten.
 *
 * A long-lived server wants a pool: ten sockets shared by every request that
 * process handles. A serverless function is the opposite shape — dozens of
 * short-lived instances, each running one request at a time, each opening its
 * own pool. `max: 10` there means ten sockets per instance against a database
 * whose free tier allows a few hundred in total, so a modest traffic spike
 * exhausts the pooler and every subsequent request fails to connect. One
 * connection per instance is the correct size when the instance only ever runs
 * one query at a time.
 *
 * `prepare: false` goes with it. Managed poolers — Neon's, Supabase's,
 * pgbouncer generally — run in transaction mode, where a connection is handed
 * to a different client between statements. Prepared statements are bound to a
 * session, so under transaction pooling they are prepared on one backend and
 * executed on another, which fails intermittently and only under load. That is
 * the worst possible failure to debug, which is why it is turned off rather
 * than left to chance.
 *
 * NETLIFY is set by Netlify's build and runtime; VERCEL by Vercel's. Both are
 * checked so this is right on either without further configuration.
 */
const isServerless = Boolean(process.env.NETLIFY ?? process.env.VERCEL);

const client =
  globalForDb.__client ??
  postgres(
    env.DATABASE_URL,
    isServerless
      ? { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 10 }
      : { max: 10 },
  );

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
