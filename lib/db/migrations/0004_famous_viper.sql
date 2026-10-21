CREATE TYPE "public"."content_scope" AS ENUM('platform', 'store');--> statement-breakpoint
CREATE TYPE "public"."content_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."placement_slot" AS ENUM('announcement_bar', 'above_content', 'below_content');--> statement-breakpoint
CREATE TYPE "public"."placement_target_type" AS ENUM('everywhere', 'home', 'search', 'cart', 'category', 'product', 'store', 'page');--> statement-breakpoint
-- saved_items and its constraints were created in 0003 by hand,
-- before its schema file existed. Skipped here so the snapshot
-- catches up without a duplicate-relation error.
--> statement-breakpoint
CREATE TABLE "page_blocks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"page_id" uuid NOT NULL,
	"type" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scope" "content_scope" NOT NULL,
	"store_id" uuid,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"published_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "placement_targets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"placement_id" uuid NOT NULL,
	"target_type" "placement_target_type" NOT NULL,
	"target_value" text,
	"is_exclusion" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "placements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scope" "content_scope" NOT NULL,
	"store_id" uuid,
	"type" text NOT NULL,
	"slot" "placement_slot" DEFAULT 'above_content' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "page_blocks" ADD CONSTRAINT "page_blocks_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_targets" ADD CONSTRAINT "placement_targets_placement_id_placements_id_fk" FOREIGN KEY ("placement_id") REFERENCES "public"."placements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placements" ADD CONSTRAINT "placements_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placements" ADD CONSTRAINT "placements_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_blocks_page_position_idx" ON "page_blocks" USING btree ("page_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "pages_platform_slug_key" ON "pages" USING btree ("slug") WHERE "pages"."store_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "pages_store_slug_key" ON "pages" USING btree ("store_id","slug") WHERE "pages"."store_id" is not null;--> statement-breakpoint
CREATE INDEX "pages_scope_status_idx" ON "pages" USING btree ("scope","status");--> statement-breakpoint
CREATE INDEX "placement_targets_placement_idx" ON "placement_targets" USING btree ("placement_id");--> statement-breakpoint
CREATE INDEX "placement_targets_lookup_idx" ON "placement_targets" USING btree ("target_type","target_value");--> statement-breakpoint
CREATE INDEX "placements_scope_status_idx" ON "placements" USING btree ("scope","status");--> statement-breakpoint
CREATE INDEX "placements_store_idx" ON "placements" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "placements_window_idx" ON "placements" USING btree ("starts_at","ends_at");