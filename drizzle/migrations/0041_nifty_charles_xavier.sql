CREATE TYPE "public"."log_level" AS ENUM('info', 'warn', 'error');--> statement-breakpoint
CREATE TABLE "app_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"level" "log_level" NOT NULL,
	"message" text NOT NULL,
	"request_id" text,
	"proc" text,
	"actor_email" text,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pid" integer,
	"hostname" text
);
--> statement-breakpoint
CREATE INDEX "app_log_created_idx" ON "app_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "app_log_level_created_idx" ON "app_log" USING btree ("level","created_at");--> statement-breakpoint
CREATE INDEX "app_log_request_idx" ON "app_log" USING btree ("request_id");