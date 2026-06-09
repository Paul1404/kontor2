CREATE TYPE "public"."email_status" AS ENUM('sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "email_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"status" "email_status" NOT NULL,
	"recipient" text,
	"subject" text,
	"detail" text,
	"entity_type" text,
	"entity_id" text,
	"actor_email" text,
	"request_id" text
);
--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "antrag_gegenzeichnung_bild" text;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "antrag_gegenzeichner_name" text;--> statement-breakpoint
CREATE INDEX "email_log_created_idx" ON "email_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "email_log_kind_created_idx" ON "email_log" USING btree ("kind","created_at");--> statement-breakpoint
CREATE INDEX "email_log_status_created_idx" ON "email_log" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "email_log_entity_idx" ON "email_log" USING btree ("entity_type","entity_id","created_at");