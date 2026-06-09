CREATE TYPE "public"."antrag_email_kind" AS ENUM('confirmation', 'club_notification', 'approval', 'decline');--> statement-breakpoint
CREATE TYPE "public"."antrag_email_status" AS ENUM('sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "membership_application_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"kind" "antrag_email_kind" NOT NULL,
	"status" "antrag_email_status" NOT NULL,
	"recipient" text,
	"subject" text,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "antrag_gegenzeichnung_bild" text;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "antrag_gegenzeichner_name" text;--> statement-breakpoint
ALTER TABLE "membership_application_emails" ADD CONSTRAINT "membership_application_emails_application_id_membership_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."membership_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "membership_application_emails_app_idx" ON "membership_application_emails" USING btree ("application_id","created_at");