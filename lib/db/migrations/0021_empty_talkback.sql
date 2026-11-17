ALTER TABLE "orders" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint

-- Backfill the method from what the intent id already tells us.
--
-- Every order placed before this column existed created its intent during
-- checkout, so the prefix is a reliable record of what was chosen: `int_` went
-- through Jomma, anything else settled offline. Recovering it here means the
-- resume path needs no special case for old orders.
--
-- Left NULL where there is no intent id at all — an order that never got that
-- far genuinely does not record a method, and a guess would be worse than
-- admitting that. Readers fall back to the same inference.
UPDATE "orders"
SET "payment_method" = CASE
  WHEN "payment_intent_id" LIKE 'int\_%' THEN 'any'
  ELSE 'manual'
END
WHERE "payment_intent_id" IS NOT NULL;

-- confirmed_at is deliberately NOT backfilled. No existing order went through
-- the confirmation gate on the prepay path, so there is no moment to invent.
-- Readers fall back to created_at, which for those orders is the truth.
