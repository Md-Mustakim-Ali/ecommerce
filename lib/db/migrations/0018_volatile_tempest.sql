ALTER TABLE "discount_redemptions" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "phone_number" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "phone_number_verified" boolean;--> statement-breakpoint
ALTER TABLE "discount_redemptions" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "contact_phone" text;--> statement-breakpoint
CREATE INDEX "discount_redemptions_phone_idx" ON "discount_redemptions" USING btree ("contact_phone");--> statement-breakpoint
CREATE INDEX "orders_unclaimed_email_idx" ON "orders" USING btree ("email") WHERE "orders"."buyer_id" is null and "orders"."email" is not null;--> statement-breakpoint
CREATE INDEX "orders_unclaimed_phone_idx" ON "orders" USING btree ("contact_phone") WHERE "orders"."buyer_id" is null and "orders"."contact_phone" is not null;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_phone_number_unique" UNIQUE("phone_number");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_contact_present" CHECK ("orders"."email" is not null or "orders"."contact_phone" is not null);