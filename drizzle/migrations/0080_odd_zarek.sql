CREATE TYPE "public"."notification_channel" AS ENUM('email', 'post');--> statement-breakpoint
ALTER TYPE "public"."email_status" ADD VALUE 'printed';--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "channel" "notification_channel" DEFAULT 'email' NOT NULL;--> statement-breakpoint
CREATE INDEX "email_log_channel_created_idx" ON "email_log" USING btree ("channel","created_at");