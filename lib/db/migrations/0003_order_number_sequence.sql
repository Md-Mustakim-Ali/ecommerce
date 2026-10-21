-- Human-readable order numbers: ORD-2026-000123.
--
-- A sequence rather than a random string, because support reads these aloud
-- and buyers search for them in email. Gaps are fine — a rolled-back order
-- burning a number is much cheaper than serialising order creation to keep
-- the sequence dense.
CREATE SEQUENCE IF NOT EXISTS order_number_seq START WITH 1 INCREMENT BY 1;
--> statement-breakpoint

-- Saved items (wishlist).
--
-- Keyed on product rather than variant: a shopper saves "that jacket", not
-- "that jacket in medium navy", and the variant is chosen later on the
-- product page.
CREATE TABLE IF NOT EXISTS saved_items (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS saved_items_user_product_key
  ON saved_items (user_id, product_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS saved_items_user_idx ON saved_items (user_id, created_at DESC);
