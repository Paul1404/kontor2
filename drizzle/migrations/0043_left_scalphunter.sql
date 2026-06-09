CREATE TYPE "public"."antrag_file_kind" AS ENUM('generated_pdf', 'signed_scan', 'approved_pdf', 'signature_image');--> statement-breakpoint
CREATE TYPE "public"."antrag_source" AS ENUM('online', 'legacy');--> statement-breakpoint
CREATE TYPE "public"."antrag_status" AS ENUM('neu', 'scan_eingegangen', 'dokument_hochgeladen', 'in_bearbeitung', 'genehmigt', 'abgelehnt');--> statement-breakpoint
CREATE TYPE "public"."antrag_token_purpose" AS ENUM('upload');--> statement-breakpoint
CREATE TYPE "public"."antrag_typ" AS ENUM('einzel', 'kind', 'familie');--> statement-breakpoint
CREATE TYPE "public"."mitgliedschaft_typ" AS ENUM('kind', 'jugendlich', 'junger_erwachsener', 'erwachsener', 'familie');--> statement-breakpoint
CREATE TABLE "membership_application_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"kind" "antrag_file_kind" NOT NULL,
	"s3_key" text NOT NULL,
	"filename" text,
	"mime_type" text,
	"size_bytes" integer,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership_application_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" "antrag_token_purpose" DEFAULT 'upload' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"antragsnummer" text NOT NULL,
	"antragstyp" "antrag_typ" DEFAULT 'einzel' NOT NULL,
	"status" "antrag_status" DEFAULT 'neu' NOT NULL,
	"source" "antrag_source" DEFAULT 'online' NOT NULL,
	"mitgliedschaft_typ" "mitgliedschaft_typ" NOT NULL,
	"geschlecht" "geschlecht",
	"vorname" text NOT NULL,
	"nachname" text NOT NULL,
	"geburtsdatum" timestamp NOT NULL,
	"strasse" text,
	"hausnummer" text,
	"plz" text,
	"ort" text,
	"telefon" text,
	"email" text,
	"erziehungsberechtigter_vorname" text,
	"erziehungsberechtigter_nachname" text,
	"partner_vorname" text,
	"partner_nachname" text,
	"partner_geburtsdatum" timestamp,
	"partner_abteilungen" jsonb,
	"kinder" jsonb,
	"abteilungen" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"elternteil_mitglied" boolean DEFAULT false NOT NULL,
	"jahresbeitrag" numeric(19, 2),
	"kontoinhaber" text,
	"iban" "bytea",
	"iban_last4" text,
	"bic" text,
	"kreditinstitut" text,
	"mandatsreferenz" text,
	"notes" text,
	"admin_decline_reason" text,
	"mitgliedsnummer" text,
	"member_id" uuid,
	"consent_at" timestamp with time zone,
	"datenschutz_accepted" boolean,
	"satzung_accepted" boolean,
	"consent_ip" text,
	"email_sent" boolean DEFAULT false NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "mandatsreferenz_prefix" text DEFAULT 'SVUWV-' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "beitragsstaffel" jsonb;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "antrag_benachrichtigung_aktiv" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "antrag_vorstand_email" text;--> statement-breakpoint
ALTER TABLE "membership_application_files" ADD CONSTRAINT "membership_application_files_application_id_membership_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."membership_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_application_tokens" ADD CONSTRAINT "membership_application_tokens_application_id_membership_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."membership_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_applications" ADD CONSTRAINT "membership_applications_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "membership_application_files_app_idx" ON "membership_application_files" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_application_tokens_hash_uk" ON "membership_application_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "membership_application_tokens_app_idx" ON "membership_application_tokens" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_applications_antragsnummer_uk" ON "membership_applications" USING btree ("antragsnummer");--> statement-breakpoint
CREATE INDEX "membership_applications_status_idx" ON "membership_applications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "membership_applications_name_idx" ON "membership_applications" USING btree ("nachname","vorname");--> statement-breakpoint
CREATE INDEX "membership_applications_email_idx" ON "membership_applications" USING btree ("email");