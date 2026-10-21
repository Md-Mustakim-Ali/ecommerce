CREATE TYPE "public"."stock_display" AS ENUM('never', 'always', 'when_low');--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "stock_display" "stock_display" DEFAULT 'when_low' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "low_stock_threshold" integer DEFAULT 5 NOT NULL;