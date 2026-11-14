CREATE TYPE "public"."media_kind" AS ENUM('image', 'video');--> statement-breakpoint
CREATE TYPE "public"."media_placement" AS ENUM('gallery', 'description');--> statement-breakpoint
CREATE TYPE "public"."media_provider" AS ENUM('managed', 'drive', 'youtube');--> statement-breakpoint
CREATE TYPE "public"."media_state" AS ENUM('queued', 'uploading', 'processing', 'ready', 'failed', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."product_publish_mode" AS ENUM('manual', 'when_media_ready');--> statement-breakpoint
CREATE TYPE "public"."google_account_state" AS ENUM('active', 'storage_full', 'rate_limited', 'revoked', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."google_grant_state" AS ENUM('active', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."google_project_state" AS ENUM('active', 'quota_exhausted', 'invalid', 'disabled');--> statement-breakpoint
CREATE TABLE "store_google_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"store_id" uuid NOT NULL,
	"email" text NOT NULL,
	"google_user_id" text NOT NULL,
	"storage_limit_bytes" bigint,
	"storage_usage_bytes" bigint,
	"storage_checked_at" timestamp with time zone,
	"state" "google_account_state" DEFAULT 'active' NOT NULL,
	"cooldown_until" timestamp with time zone,
	"priority" integer DEFAULT 0 NOT NULL,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_google_grants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"project_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"scopes" text DEFAULT '' NOT NULL,
	"state" "google_grant_state" DEFAULT 'active' NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_google_projects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"store_id" uuid NOT NULL,
	"label" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_enc" text NOT NULL,
	"daily_unit_limit" integer DEFAULT 10000 NOT NULL,
	"units_used" integer DEFAULT 0 NOT NULL,
	"units_reset_at" timestamp with time zone NOT NULL,
	"state" "google_project_state" DEFAULT 'active' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_images" ALTER COLUMN "url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "kind" "media_kind" DEFAULT 'image' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "provider" "media_provider" DEFAULT 'managed' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "placement" "media_placement" DEFAULT 'gallery' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "provider_ref" text;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "google_account_id" uuid;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "state" "media_state" DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "upload_session_uri" text;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "check_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "description_doc" jsonb;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "publish_mode" "product_publish_mode" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_google_accounts" ADD CONSTRAINT "store_google_accounts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_google_grants" ADD CONSTRAINT "store_google_grants_project_id_store_google_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."store_google_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_google_grants" ADD CONSTRAINT "store_google_grants_account_id_store_google_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."store_google_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_google_projects" ADD CONSTRAINT "store_google_projects_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_google_accounts_store_user_key" ON "store_google_accounts" USING btree ("store_id","google_user_id");--> statement-breakpoint
CREATE INDEX "store_google_accounts_store_state_idx" ON "store_google_accounts" USING btree ("store_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "store_google_grants_pair_key" ON "store_google_grants" USING btree ("project_id","account_id");--> statement-breakpoint
CREATE INDEX "store_google_grants_account_idx" ON "store_google_grants" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_google_projects_store_client_key" ON "store_google_projects" USING btree ("store_id","client_id");--> statement-breakpoint
CREATE INDEX "store_google_projects_store_state_idx" ON "store_google_projects" USING btree ("store_id","state");--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_google_account_id_store_google_accounts_id_fk" FOREIGN KEY ("google_account_id") REFERENCES "public"."store_google_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_images_state_idx" ON "product_images" USING btree ("state","last_checked_at");