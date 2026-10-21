CREATE TYPE "public"."attribute_kind" AS ENUM('select', 'color', 'number', 'text');--> statement-breakpoint
CREATE TYPE "public"."product_attribute_role" AS ENUM('variant', 'spec');--> statement-breakpoint
CREATE TABLE "attribute_values" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"attribute_id" uuid NOT NULL,
	"value" text NOT NULL,
	"slug" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"status" "catalog_term_status" DEFAULT 'pending' NOT NULL,
	"merged_into_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attributes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" "attribute_kind" DEFAULT 'select' NOT NULL,
	"unit" text,
	"is_filterable" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"status" "catalog_term_status" DEFAULT 'pending' NOT NULL,
	"merged_into_id" uuid,
	"created_by" text,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_attribute_values" (
	"product_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"value_id" uuid NOT NULL,
	CONSTRAINT "product_attribute_values_product_id_value_id_pk" PRIMARY KEY("product_id","value_id")
);
--> statement-breakpoint
CREATE TABLE "product_attributes" (
	"product_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"role" "product_attribute_role" DEFAULT 'variant' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_attributes_product_id_attribute_id_pk" PRIMARY KEY("product_id","attribute_id")
);
--> statement-breakpoint
CREATE TABLE "variant_attribute_values" (
	"variant_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"value_id" uuid NOT NULL,
	CONSTRAINT "variant_attribute_values_variant_id_attribute_id_pk" PRIMARY KEY("variant_id","attribute_id")
);
--> statement-breakpoint
ALTER TABLE "attribute_values" ADD CONSTRAINT "attribute_values_attribute_id_attributes_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."attributes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribute_values" ADD CONSTRAINT "attribute_values_merged_into_id_attribute_values_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."attribute_values"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribute_values" ADD CONSTRAINT "attribute_values_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attributes" ADD CONSTRAINT "attributes_merged_into_id_attributes_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."attributes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attributes" ADD CONSTRAINT "attributes_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attributes" ADD CONSTRAINT "attributes_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_attribute_id_attributes_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."attributes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_value_id_attribute_values_id_fk" FOREIGN KEY ("value_id") REFERENCES "public"."attribute_values"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_attribute_id_attributes_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."attributes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_attribute_values" ADD CONSTRAINT "variant_attribute_values_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_attribute_values" ADD CONSTRAINT "variant_attribute_values_attribute_id_attributes_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."attributes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_attribute_values" ADD CONSTRAINT "variant_attribute_values_value_id_attribute_values_id_fk" FOREIGN KEY ("value_id") REFERENCES "public"."attribute_values"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attribute_values_attribute_slug_key" ON "attribute_values" USING btree ("attribute_id","slug");--> statement-breakpoint
CREATE INDEX "attribute_values_attribute_idx" ON "attribute_values" USING btree ("attribute_id","position");--> statement-breakpoint
CREATE INDEX "attribute_values_trgm_idx" ON "attribute_values" USING gin ("value" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "attributes_slug_key" ON "attributes" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "attributes_status_idx" ON "attributes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "attributes_name_trgm_idx" ON "attributes" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "product_attribute_values_value_idx" ON "product_attribute_values" USING btree ("value_id");--> statement-breakpoint
CREATE INDEX "product_attribute_values_attribute_idx" ON "product_attribute_values" USING btree ("attribute_id");--> statement-breakpoint
CREATE INDEX "product_attributes_attribute_idx" ON "product_attributes" USING btree ("attribute_id");--> statement-breakpoint
CREATE INDEX "variant_attribute_values_value_idx" ON "variant_attribute_values" USING btree ("value_id");