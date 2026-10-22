CREATE TYPE "public"."order_note_author" AS ENUM('staff', 'buyer');--> statement-breakpoint
CREATE TYPE "public"."order_note_visibility" AS ENUM('internal', 'buyer');--> statement-breakpoint
CREATE TABLE "order_notes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"sub_order_id" uuid NOT NULL,
	"author_role" "order_note_author" NOT NULL,
	"visibility" "order_note_visibility" NOT NULL,
	"author_id" text,
	"author_name" text NOT NULL,
	"body" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_notes" ADD CONSTRAINT "order_notes_sub_order_id_sub_orders_id_fk" FOREIGN KEY ("sub_order_id") REFERENCES "public"."sub_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_notes" ADD CONSTRAINT "order_notes_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_notes_sub_order_idx" ON "order_notes" USING btree ("sub_order_id","created_at");--> statement-breakpoint
CREATE INDEX "order_notes_visible_idx" ON "order_notes" USING btree ("sub_order_id","created_at") WHERE "order_notes"."visibility" = 'buyer';