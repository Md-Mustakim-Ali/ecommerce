CREATE TABLE "jomma_applied_payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"intent_id" text NOT NULL,
	"trx_id" text,
	"sender_msisdn" text,
	"amount_cents" integer NOT NULL,
	"occurred_at" timestamp with time zone,
	"applied_at" timestamp with time zone NOT NULL,
	"match_confidence" text NOT NULL,
	"matched_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jomma_applied_payments" ADD CONSTRAINT "jomma_applied_payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jomma_payments_order_idx" ON "jomma_applied_payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "jomma_payments_trx_idx" ON "jomma_applied_payments" USING btree ("trx_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jomma_payments_unique_idx" ON "jomma_applied_payments" USING btree ("intent_id",coalesce("trx_id", ''),"applied_at");