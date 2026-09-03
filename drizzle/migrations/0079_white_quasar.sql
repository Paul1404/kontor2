ALTER TYPE "public"."email_status" ADD VALUE 'bounced';--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "message_id" text;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "bounced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "bounce_code" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "email_undeliverable_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "email_undeliverable_reason" text;--> statement-breakpoint
CREATE INDEX "email_log_message_id_idx" ON "email_log" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "email_log_recipient_created_idx" ON "email_log" USING btree ("recipient","created_at");