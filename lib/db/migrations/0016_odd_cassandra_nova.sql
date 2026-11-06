ALTER TYPE "public"."order_status" ADD VALUE 'payment_reversed';--> statement-breakpoint
CREATE TABLE "jomma_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"intent_id" text,
	"client_reference" text,
	"payload" jsonb NOT NULL,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "jomma_events_intent_idx" ON "jomma_webhook_events" USING btree ("intent_id");--> statement-breakpoint
CREATE INDEX "jomma_events_reference_idx" ON "jomma_webhook_events" USING btree ("client_reference");--> statement-breakpoint
CREATE INDEX "jomma_events_unhandled_idx" ON "jomma_webhook_events" USING btree ("created_at") WHERE "jomma_webhook_events"."handled_at" is null;