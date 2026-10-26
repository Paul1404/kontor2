ALTER TYPE "public"."familien_rolle" ADD VALUE 'sorgeberechtigt';--> statement-breakpoint
CREATE TABLE "birthday_reminder_deliveries" (
	"week" text NOT NULL,
	"recipient" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "birthday_reminder_deliveries_week_recipient_pk" PRIMARY KEY("week","recipient")
);
--> statement-breakpoint
CREATE TABLE "birthday_reminder_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"time" text DEFAULT '08:00' NOT NULL,
	"user_ids" text[] DEFAULT '{}' NOT NULL,
	"emails" text[] DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "familien_mitglieder" ADD COLUMN "is_guardian" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "familien" ADD COLUMN "guardian_member_id" uuid;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "previous_member_no" text;--> statement-breakpoint
ALTER TABLE "familien" ADD CONSTRAINT "familien_guardian_member_id_members_id_fk" FOREIGN KEY ("guardian_member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;