CREATE TABLE "platform_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"commission_bps" integer DEFAULT 1000 NOT NULL,
	"free_shipping_threshold_cents" integer DEFAULT 7500 NOT NULL,
	"flat_shipping_cents" integer DEFAULT 599 NOT NULL,
	"maintenance_notice" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_settings_single_row" CHECK ("platform_settings"."id" = 'default'),
	CONSTRAINT "platform_settings_commission_range" CHECK ("platform_settings"."commission_bps" >= 0 and "platform_settings"."commission_bps" <= 10000)
);
--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;