CREATE TYPE "public"."dsgvo_consent_type" AS ENUM('datenverarbeitung', 'foto_name', 'newsletter', 'vereinszeitung');--> statement-breakpoint
CREATE TYPE "public"."dsgvo_request_status" AS ENUM('open', 'in_progress', 'completed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."dsgvo_request_type" AS ENUM('auskunft', 'berichtigung', 'loeschung', 'einschraenkung', 'widerspruch');--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'dsgvo_export';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'dsgvo_erasure';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'dsgvo_consent_change';--> statement-breakpoint
ALTER TYPE "public"."audit_source" ADD VALUE 'dsgvo';--> statement-breakpoint
CREATE TABLE "bestandserhebungen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stichtag" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"created_by_email" text,
	"breakdown" jsonb NOT NULL,
	"signed_off" boolean DEFAULT false NOT NULL,
	"signed_off_at" timestamp with time zone,
	"signed_off_by" text,
	"signed_off_by_email" text,
	"deliverable_sha256" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "dsgvo_consent_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"consent_type" "dsgvo_consent_type" NOT NULL,
	"granted" boolean NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by" text,
	"recorded_by_email" text,
	"evidence" text
);
--> statement-breakpoint
CREATE TABLE "dsgvo_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid,
	"type" "dsgvo_request_type" NOT NULL,
	"status" "dsgvo_request_status" DEFAULT 'open' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"requested_by" text,
	"requested_by_email" text,
	"deadline" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" text,
	"notes" text,
	"deliverable_sha256" text,
	"deliverable_size_bytes" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bestandserhebungen" ADD CONSTRAINT "bestandserhebungen_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bestandserhebungen" ADD CONSTRAINT "bestandserhebungen_signed_off_by_users_id_fk" FOREIGN KEY ("signed_off_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dsgvo_consent_log" ADD CONSTRAINT "dsgvo_consent_log_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dsgvo_consent_log" ADD CONSTRAINT "dsgvo_consent_log_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dsgvo_requests" ADD CONSTRAINT "dsgvo_requests_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dsgvo_requests" ADD CONSTRAINT "dsgvo_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dsgvo_requests" ADD CONSTRAINT "dsgvo_requests_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bestandserhebungen_stichtag_idx" ON "bestandserhebungen" USING btree ("stichtag");--> statement-breakpoint
CREATE INDEX "bestandserhebungen_created_idx" ON "bestandserhebungen" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "dsgvo_consent_member_type_idx" ON "dsgvo_consent_log" USING btree ("member_id","consent_type","recorded_at");--> statement-breakpoint
CREATE INDEX "dsgvo_consent_recorded_idx" ON "dsgvo_consent_log" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "dsgvo_requests_member_idx" ON "dsgvo_requests" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "dsgvo_requests_status_idx" ON "dsgvo_requests" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "dsgvo_requests_requested_idx" ON "dsgvo_requests" USING btree ("requested_at");