CREATE TYPE "public"."dunning_run_status" AS ENUM('draft', 'committed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."dunning_sent_channel" AS ENUM('pending', 'email', 'letter');--> statement-breakpoint
CREATE TYPE "public"."portal_change_status" AS ENUM('pending', 'applied', 'rejected', 'partial');--> statement-breakpoint
CREATE TABLE "dunning_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dunning_run_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"level" integer NOT NULL,
	"soll_ids_json" text DEFAULT '[]' NOT NULL,
	"items_json" text DEFAULT '[]' NOT NULL,
	"open_sum" numeric(19, 8) NOT NULL,
	"mahngebuhr" numeric(19, 8) DEFAULT '0' NOT NULL,
	"total_due" numeric(19, 8) NOT NULL,
	"due_date" date NOT NULL,
	"sent_channel" "dunning_sent_channel" DEFAULT 'pending' NOT NULL,
	"sent_to" text,
	"sent_at" timestamp with time zone,
	"pdf_filename" text,
	"pdf_base64" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dunning_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"level" integer NOT NULL,
	"status" "dunning_run_status" DEFAULT 'draft' NOT NULL,
	"run_date" date NOT NULL,
	"due_date" date NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"total_open" numeric(19, 8) DEFAULT '0' NOT NULL,
	"total_fees" numeric(19, 8) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text
);
--> statement-breakpoint
CREATE TABLE "sepa_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fee_run_item_id" uuid NOT NULL,
	"soll_stellung_id" uuid,
	"member_id" uuid NOT NULL,
	"returned_on" date NOT NULL,
	"reason_code" text,
	"reason_text" text,
	"rueckgebuhr" numeric(19, 8) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "portal_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"session_id" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_ip" text,
	"payload" jsonb NOT NULL,
	"status" "portal_change_status" DEFAULT 'pending' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"reviewer_notes" text,
	"applied_fields" jsonb
);
--> statement-breakpoint
CREATE TABLE "portal_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"secret_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_from_token_id" uuid
);
--> statement-breakpoint
CREATE TABLE "portal_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"sent_to_email" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "mahngebuhr1" numeric(19, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "mahngebuhr2" numeric(19, 2) DEFAULT '5' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "mahngebuhr3" numeric(19, 2) DEFAULT '10' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "sepa_return_fee" numeric(19, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "mahn_frist_tage" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "dunning_items" ADD CONSTRAINT "dunning_items_dunning_run_id_dunning_runs_id_fk" FOREIGN KEY ("dunning_run_id") REFERENCES "public"."dunning_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dunning_items" ADD CONSTRAINT "dunning_items_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dunning_runs" ADD CONSTRAINT "dunning_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dunning_runs" ADD CONSTRAINT "dunning_runs_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_returns" ADD CONSTRAINT "sepa_returns_fee_run_item_id_fee_run_items_id_fk" FOREIGN KEY ("fee_run_item_id") REFERENCES "public"."fee_run_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_returns" ADD CONSTRAINT "sepa_returns_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_returns" ADD CONSTRAINT "sepa_returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_change_requests" ADD CONSTRAINT "portal_change_requests_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_change_requests" ADD CONSTRAINT "portal_change_requests_session_id_portal_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."portal_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_change_requests" ADD CONSTRAINT "portal_change_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_created_from_token_id_portal_tokens_id_fk" FOREIGN KEY ("created_from_token_id") REFERENCES "public"."portal_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_tokens" ADD CONSTRAINT "portal_tokens_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_tokens" ADD CONSTRAINT "portal_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dunning_items_run_idx" ON "dunning_items" USING btree ("dunning_run_id");--> statement-breakpoint
CREATE INDEX "dunning_items_member_idx" ON "dunning_items" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "dunning_runs_status_idx" ON "dunning_runs" USING btree ("status","run_date");--> statement-breakpoint
CREATE INDEX "dunning_runs_date_idx" ON "dunning_runs" USING btree ("run_date");--> statement-breakpoint
CREATE INDEX "sepa_returns_member_idx" ON "sepa_returns" USING btree ("member_id","returned_on");--> statement-breakpoint
CREATE INDEX "sepa_returns_item_idx" ON "sepa_returns" USING btree ("fee_run_item_id");--> statement-breakpoint
CREATE INDEX "sepa_returns_returned_idx" ON "sepa_returns" USING btree ("returned_on");--> statement-breakpoint
CREATE INDEX "portal_change_requests_member_idx" ON "portal_change_requests" USING btree ("member_id","submitted_at");--> statement-breakpoint
CREATE INDEX "portal_change_requests_status_idx" ON "portal_change_requests" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE INDEX "portal_sessions_member_idx" ON "portal_sessions" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_tokens_hash_uk" ON "portal_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "portal_tokens_member_idx" ON "portal_tokens" USING btree ("member_id");