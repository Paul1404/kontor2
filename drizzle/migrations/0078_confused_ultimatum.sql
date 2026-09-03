ALTER TYPE "public"."attachment_kind" ADD VALUE 'cancellation_notice';--> statement-breakpoint
CREATE TABLE "member_cancellations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"evidence_attachment_id" uuid NOT NULL,
	"notice_received_on" date NOT NULL,
	"effective_date" date NOT NULL,
	"computed_effective_date" date NOT NULL,
	"date_mode" text NOT NULL,
	"notice_days" integer NOT NULL,
	"statute_reference" text,
	"overridden" boolean DEFAULT false NOT NULL,
	"override_reason" text,
	"sepa_revoked" boolean NOT NULL,
	"closed_abteilungen" integer DEFAULT 0 NOT NULL,
	"closed_vertraege" integer DEFAULT 0 NOT NULL,
	"revoked_sepa_mandate" integer DEFAULT 0 NOT NULL,
	"note" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by" text,
	"recorded_by_email" text,
	"audit_id" uuid,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "member_cancellations" ADD CONSTRAINT "member_cancellations_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_cancellations" ADD CONSTRAINT "member_cancellations_evidence_attachment_id_attachments_id_fk" FOREIGN KEY ("evidence_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_cancellations" ADD CONSTRAINT "member_cancellations_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_cancellations" ADD CONSTRAINT "member_cancellations_audit_id_audit_log_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audit_log"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_cancellations_evidence_uk" ON "member_cancellations" USING btree ("evidence_attachment_id");--> statement-breakpoint
CREATE INDEX "member_cancellations_member_recorded_idx" ON "member_cancellations" USING btree ("member_id","recorded_at");