CREATE TYPE "public"."attachment_kind" AS ENUM('general', 'bank_details_change');--> statement-breakpoint
CREATE TABLE "member_bank_detail_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"evidence_attachment_id" uuid NOT NULL,
	"requested_at" date NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_by" text,
	"applied_by_email" text,
	"audit_id" uuid,
	"previous_iban_last4" text,
	"new_iban_last4" text NOT NULL,
	"account_holder_changed" boolean NOT NULL,
	"debit_suspended" boolean NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "kind" "attachment_kind" DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "pending_uploads" ADD COLUMN "kind" "attachment_kind" DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "member_bank_detail_changes" ADD CONSTRAINT "member_bank_detail_changes_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_bank_detail_changes" ADD CONSTRAINT "member_bank_detail_changes_evidence_attachment_id_attachments_id_fk" FOREIGN KEY ("evidence_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_bank_detail_changes" ADD CONSTRAINT "member_bank_detail_changes_applied_by_users_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_bank_detail_changes" ADD CONSTRAINT "member_bank_detail_changes_audit_id_audit_log_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audit_log"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_bank_detail_changes_evidence_uk" ON "member_bank_detail_changes" USING btree ("evidence_attachment_id");--> statement-breakpoint
CREATE INDEX "member_bank_detail_changes_member_applied_idx" ON "member_bank_detail_changes" USING btree ("member_id","applied_at");