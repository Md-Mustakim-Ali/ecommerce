import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";

/**
 * Platform settings.
 *
 * A single row, keyed by a constant, rather than a key-value table. Settings
 * are read together by whatever needs one, and a typed column per setting
 * catches a rename at build time — a key-value store turns every read into a
 * string lookup that only fails at runtime.
 *
 * The commission rate lives here rather than in code because changing it is an
 * operational decision, not a deploy. What it must never do is change the rate
 * on orders already placed: `sub_orders.commission_cents` is written at
 * purchase time and read from there forever, so this only affects new orders.
 */
export const platformSettings = pgTable(
  "platform_settings",
  {
    /** Always "default". The CHECK below keeps the table to one row. */
    id: text("id").primaryKey().default("default"),

    /** Basis points, so 8.5% is exact rather than a rounded float. */
    commissionBps: integer("commission_bps").notNull().default(1000),

    /** Order subtotal at or above which shipping is free, in minor units. */
    freeShippingThresholdCents: integer("free_shipping_threshold_cents")
      .notNull()
      .default(7500),

    /** Flat shipping charged below the threshold, in minor units. */
    flatShippingCents: integer("flat_shipping_cents").notNull().default(599),

    /** Shown across the storefront when set. Plain text. */
    maintenanceNotice: text("maintenance_notice"),

    updatedBy: text("updated_by").references(() => user.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One row, enforced by the database rather than by everyone remembering.
    check("platform_settings_single_row", sql`${t.id} = 'default'`),
    check(
      "platform_settings_commission_range",
      sql`${t.commissionBps} >= 0 and ${t.commissionBps} <= 10000`,
    ),
  ],
);
