CREATE TYPE "public"."analytics_event_type" AS ENUM('page_view', 'product_view', 'search', 'product_click', 'add_to_cart', 'remove_from_cart', 'wishlist_add', 'wishlist_remove', 'checkout_start', 'ui_click');--> statement-breakpoint
CREATE TYPE "public"."report_reason" AS ENUM('counterfeit', 'prohibited', 'misleading', 'offensive', 'spam', 'intellectual_property', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'reviewing', 'upheld', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."report_target_type" AS ENUM('product', 'review', 'store');--> statement-breakpoint
CREATE TABLE "analytics_daily" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"day" date NOT NULL,
	"type" "analytics_event_type" NOT NULL,
	"store_id" uuid,
	"product_id" uuid,
	"variant_id" uuid,
	"events" bigint DEFAULT 0 NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_daily_sessions" (
	"day" date NOT NULL,
	"type" "analytics_event_type" NOT NULL,
	"store_id" uuid,
	"product_id" uuid,
	"session_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"type" "analytics_event_type" NOT NULL,
	"session_id" text NOT NULL,
	"user_id" text,
	"store_id" uuid,
	"product_id" uuid,
	"variant_id" uuid,
	"path" text,
	"label" text,
	"meta" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"reporter_id" text NOT NULL,
	"target_type" "report_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid,
	"review_id" uuid,
	"reason" "report_reason" NOT NULL,
	"detail" text,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"resolved_by_id" text,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_daily" ADD CONSTRAINT "analytics_daily_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_daily" ADD CONSTRAINT "analytics_daily_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_daily" ADD CONSTRAINT "analytics_daily_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_user_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_id_user_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_daily_key" ON "analytics_daily" USING btree ("day","type",coalesce("store_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("product_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("variant_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE INDEX "analytics_daily_store_day_idx" ON "analytics_daily" USING btree ("store_id","day");--> statement-breakpoint
CREATE INDEX "analytics_daily_product_day_idx" ON "analytics_daily" USING btree ("product_id","day");--> statement-breakpoint
CREATE INDEX "analytics_daily_type_day_idx" ON "analytics_daily" USING btree ("type","day");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_daily_sessions_key" ON "analytics_daily_sessions" USING btree ("day","type",coalesce("store_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("product_id", '00000000-0000-0000-0000-000000000000'::uuid),"session_id");--> statement-breakpoint
CREATE INDEX "analytics_daily_sessions_day_idx" ON "analytics_daily_sessions" USING btree ("day");--> statement-breakpoint
CREATE INDEX "analytics_events_occurred_idx" ON "analytics_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "analytics_events_product_idx" ON "analytics_events" USING btree ("product_id","occurred_at");--> statement-breakpoint
CREATE INDEX "analytics_events_store_idx" ON "analytics_events" USING btree ("store_id","occurred_at");--> statement-breakpoint
CREATE INDEX "analytics_events_session_idx" ON "analytics_events" USING btree ("session_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_one_open_per_reporter" ON "reports" USING btree ("reporter_id","target_type","target_id") WHERE status in ('open', 'reviewing');--> statement-breakpoint
CREATE INDEX "reports_status_created_idx" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "reports_store_status_idx" ON "reports" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "reports_target_idx" ON "reports" USING btree ("target_type","target_id");