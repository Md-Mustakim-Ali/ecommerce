# Data model

Postgres 18. Drizzle schema in `lib/db/schema/`, one file per domain.

All primary keys use `uuidv7()`, which is native in Postgres 18 and gives
timestamp-ordered UUIDs with far better index locality than `uuid_generate_v4()`.

```sql
id uuid primary key default uuidv7()
```

Every table gets `created_at` and `updated_at` as `timestamptz`.

---

## Identity

```
users
  id, email (unique, citext), email_verified, name, avatar_url,
  phone, default_locale, created_at

user_roles
  user_id, role                     -- buyer | seller | admin
  unique (user_id, role)
```

A user can hold several roles. A seller is also a buyer. Do not put a single
`role` column on `users`.

Better Auth generates its own `session` and `account` tables. Do not hand-write
those; run its CLI and let it own that schema.

```
addresses
  id, user_id, label, recipient_name, phone,
  line1, line2, city, region, postal_code, country_code,
  is_default_shipping, is_default_billing
```

Addresses are versioned by copy, not by reference. When an order is placed, the
shipping address is **snapshotted onto the order**. Editing a saved address must
never change what a past order says it shipped to.

---

## Stores

```
stores
  id, owner_id -> users.id
  name, slug (unique), description
  logo_url, banner_url
  status                            -- pending | active | suspended | closed
  accent_color, layout_preset       -- constrained theming; see open decision #3
  support_email, support_phone
  created_at
```

A user may own more than one store. Every seller-side query filters by
`store_id` and verifies ownership server-side.

---

## Catalog

### Brands (the deduplication problem)

Brands are **platform-level**. A store does not own "Samsung"; it just sells
Samsung products.

```
brands
  id
  name                              -- display name, e.g. "Samsung"
  slug          unique              -- normalization key, e.g. "samsung"
  logo_url
  status                            -- pending | approved | rejected
  created_by -> users.id            -- which seller proposed it
  approved_by -> users.id, approved_at
```

The `slug` is what prevents duplicates. Normalize on write: lowercase, trim,
strip punctuation, collapse whitespace to single hyphens. `"Samsung"`,
`"SAMSUNG "`, and `"samsung"` all become `samsung`, and the unique index rejects
the second insert.

Normalization alone is not enough. Add the workflow:

1. Seller searches existing approved brands when listing a product.
2. If not found, they propose a new one. It saves as `pending`.
3. An admin approves, rejects, or merges it into an existing brand.
4. Only `approved` brands appear in buyer-facing filters.

Without step 3 you get "Samsng" and "Samsung Electronics" as separate brands
within a month. Consider a `pg_trgm` similarity check on submission to warn the
seller that a near-match already exists.

Brand is nullable on products. Not everything has one.

### Categories

```
categories
  id, parent_id -> categories.id
  name, slug (unique), position
```

Global tree, shared by all stores. Sellers pick from it; they do not create
categories. Depth of 3 is usually enough.

### Products

```
products
  id, store_id -> stores.id
  brand_id -> brands.id             -- nullable
  category_id -> categories.id
  title, slug, description
  status                            -- draft | active | archived
  attributes jsonb                  -- category-specific fields
  search_vector tsvector            -- generated, GIN indexed
  unique (store_id, slug)

product_images
  id, product_id, url, alt, position, blur_data_url

product_variants
  id, product_id
  sku (unique per store)
  option_values jsonb               -- { "size": "M", "color": "Navy" }
  price_cents integer               -- always integer minor units, never float
  compare_at_price_cents
  stock integer
  weight_grams
```

Every product has at least one variant, even when it has no options. A single
"default" variant keeps the checkout code from branching.

`attributes` as JSONB is the escape hatch for fields that differ per category
(screen size for monitors, fabric for shirts). Structured data stays in columns.

**Search.** Start with a generated `tsvector` over title, description, and brand
name, with a GIN index. Do not add a search service until this is measurably slow
against production-sized data.

---

## Cart

```
carts
  id, user_id (nullable for guests), session_token
  created_at, updated_at

cart_items
  id, cart_id, variant_id, quantity, added_at
  unique (cart_id, variant_id)
```

Cart holds `variant_id` and quantity only. Never store price on the cart. Price is
resolved live at render and again at checkout, so a price change is reflected
immediately.

Move carts to Redis in Phase 3 if Postgres write load becomes a problem. Not before.

---

## Orders

This is the part most marketplaces get wrong. A cart with items from three sellers
is one payment and three fulfillments.

```
orders                              -- the buyer's view. One payment.
  id, buyer_id -> users.id
  order_number                      -- human-readable, e.g. ORD-2026-000123
  status                            -- pending | paid | partially_fulfilled
                                    -- | fulfilled | cancelled | refunded
  subtotal_cents, shipping_cents, tax_cents, discount_cents, total_cents
  currency
  shipping_address jsonb            -- SNAPSHOT, not a foreign key
  billing_address jsonb             -- SNAPSHOT
  payment_intent_id
  placed_at

sub_orders                          -- one per store. The seller's view.
  id, order_id, store_id
  status                            -- pending | accepted | shipped
                                    -- | delivered | cancelled | refunded
  subtotal_cents, shipping_cents, commission_cents, payout_cents
  tracking_carrier, tracking_number, shipped_at, delivered_at

order_items
  id, sub_order_id
  variant_id                        -- reference for support lookups only
  product_title, variant_label, sku, image_url    -- SNAPSHOTS
  unit_price_cents                                -- SNAPSHOT
  quantity, line_total_cents
```

Everything marked SNAPSHOT is copied at purchase time and never updated. If a
seller renames a product or deletes it entirely, the old order still renders
exactly as the buyer saw it. This is not optional; it is what makes disputes and
accounting possible.

`sub_orders` cannot be retrofitted cheaply. Build it now.

---

## Money

The ledger is **append-only**. There is no mutable balance column in this schema.
Balances are computed as a `SUM` over immutable entries.

```
ledger_entries
  id
  store_id -> stores.id
  sub_order_id                      -- nullable; adjustments have no order
  type                              -- sale | commission | refund
                                    -- | adjustment | payout | fee
  amount_cents bigint               -- signed. credits positive, debits negative.
  currency
  description
  created_at                        -- never updated, never deleted
```

Available balance for a store:

```sql
select coalesce(sum(amount_cents), 0)
from ledger_entries
where store_id = $1 and currency = $2;
```

```
payouts
  id, store_id
  amount_cents, currency
  status                            -- pending | processing | paid | failed
  provider_transfer_id
  period_start, period_end
  initiated_at, completed_at
```

A payout writes a negative `ledger_entries` row of type `payout`. It never edits
an existing row.

Rules that follow from this:

- No `UPDATE` and no `DELETE` on `ledger_entries`, ever. Enforce with a database
  trigger, not just discipline.
- All amounts are integer minor units (cents, paisa). Never floating point.
- A refund is a new negative entry, not a modification of the sale entry.
- Reconciliation is a query, not a stored value.

When a payout goes wrong six months in, and one will, the ledger is the only thing
that lets you find out what actually happened.

---

## Reviews

```
reviews
  id, product_id, buyer_id, order_item_id
  rating smallint                   -- 1..5
  title, body
  status                            -- published | flagged | removed
  unique (order_item_id)
```

Tying a review to `order_item_id` means only verified purchasers can review, and
only once per purchase.

---

## Indexes that matter

```sql
create index on products (store_id, status);
create index on products (category_id, status);
create index on products using gin (search_vector);
create index on product_variants (product_id);
create index on sub_orders (store_id, status);
create index on order_items (sub_order_id);
create index on ledger_entries (store_id, created_at);
create unique index on brands (slug);
```

Add the rest when a real query is slow. Do not index speculatively.
