CREATE TABLE "auth_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"session_expires_in_days" integer DEFAULT 90 NOT NULL,
	"session_update_age_hours" integer DEFAULT 24 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "auth_settings" ADD CONSTRAINT "auth_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;