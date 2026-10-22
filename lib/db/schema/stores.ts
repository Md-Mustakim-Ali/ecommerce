import { relations } from "drizzle-orm";
import { index, pgEnum, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared";
import { user } from "./auth";

export const storeStatus = pgEnum("store_status", [
  "pending",
  "active",
  "suspended",
  "closed",
]);

/** Constrained theming, per the decision in AGENTS.md. Sellers pick, not build. */
export const storeLayoutPreset = pgEnum("store_layout_preset", [
  "classic",
  "editorial",
  "gallery",
]);

export const stores = pgTable(
  "stores",
  {
    id: primaryId(),

    /**
     * The account that created the store. Immutable except through an explicit
     * ownership transfer, which is owner-only and not expressible as a
     * permission. See OWNER_ONLY_ACTIONS in lib/auth/permissions.ts.
     *
     * The owner implicitly holds every store permission and cannot be stripped
     * of them, so an owner can never lock themselves out of their own store.
     */
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),

    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),

    logoUrl: text("logo_url"),
    bannerUrl: text("banner_url"),

    status: storeStatus("status").notNull().default("pending"),

    // Constrained theming only. Product page, cart and checkout are identical
    // across every store, because consistency there protects conversion.
    accentColor: text("accent_color"),
    layoutPreset: storeLayoutPreset("layout_preset")
      .notNull()
      .default("classic"),

    supportEmail: text("support_email"),
    supportPhone: text("support_phone"),

    /**
     * Where payouts go, as an opaque reference from the payment provider.
     *
     * Deliberately not bank details. An account number and sort code in this
     * database would make it a target worth attacking and would drag the whole
     * application into PCI/PSD2 scope for no benefit — the provider already
     * holds them, and a reference is all that is needed to send money.
     *
     * Null means payouts cannot be sent yet.
     */
    payoutAccountRef: text("payout_account_ref"),
    /** Shown to the owner so they can tell which account this is. */
    payoutAccountLabel: text("payout_account_label"),

    /** Legal entity name for invoices. Not the trading name. */
    billingName: text("billing_name"),
    billingTaxId: text("billing_tax_id"),
    billingAddress: text("billing_address"),

    ...timestamps,
  },
  (t) => [
    uniqueIndex("stores_slug_key").on(t.slug),
    index("stores_owner_idx").on(t.ownerId),
    index("stores_status_idx").on(t.status),
  ],
);

export const storesRelations = relations(stores, ({ one }) => ({
  owner: one(user, { fields: [stores.ownerId], references: [user.id] }),
}));
