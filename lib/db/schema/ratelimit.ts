import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { primaryId } from "./_shared";

/**
 * Rate limit counters.
 *
 * Postgres rather than Redis, deliberately. Redis is the right answer at
 * volume, but adding a second datastore for one feature means a second thing
 * to run, monitor and back up — and a limiter that fails open when it is down.
 * A single row per key per window is one upsert on requests that are already
 * doing database work, and the whole table stays small because expired rows
 * are swept on write.
 *
 * The window is fixed, not sliding. A fixed window lets through up to twice
 * the limit across a boundary, which matters for a quota and does not matter
 * for "stop someone brute-forcing a password" — that attacker needs thousands
 * of attempts, not eleven. Sliding would mean storing every hit.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    id: primaryId(),

    /**
     * bucket:subject — e.g. "sign-in:203.0.113.4" or "checkout:user_abc".
     * Never the credential being tried, only who is trying.
     */
    key: text("key").notNull(),

    /** Start of the window this row counts. */
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),

    count: integer("count").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The ON CONFLICT target, so concurrent requests increment one row rather
    // than racing to insert two and each seeing a count of 1.
    uniqueIndex("rate_limits_key_window_key").on(t.key, t.windowStart),
    // Used by the sweep.
    index("rate_limits_window_idx").on(t.windowStart),
  ],
);
