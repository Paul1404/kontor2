CREATE TYPE "public"."archive_posting_triage_status" AS ENUM('offen', 'erledigt', 'ignoriert');--> statement-breakpoint
CREATE TABLE "linear_archive_posting_triage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"soll_guid" text NOT NULL,
	"status" "archive_posting_triage_status" DEFAULT 'offen' NOT NULL,
	"notiz" text,
	"mitgliedsnummer" text,
	"adr_nr" integer,
	"jahr" integer,
	"art" text,
	"betrag" numeric(19, 8),
	"actor_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "linear_archive_posting_triage_guid_uk" ON "linear_archive_posting_triage" USING btree ("soll_guid");--> statement-breakpoint
CREATE INDEX "linear_archive_posting_triage_status_idx" ON "linear_archive_posting_triage" USING btree ("status");