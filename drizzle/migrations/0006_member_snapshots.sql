CREATE TYPE "public"."snapshot_trigger" AS ENUM('mutation', 'nightly', 'manual', 'pre_restore', 'pre_import');--> statement-breakpoint
CREATE TABLE "member_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"member_id" uuid NOT NULL,
	"trigger" "snapshot_trigger" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" text,
	"actor_email" text,
	"audit_id" uuid,
	"notes" text,
	"member" jsonb NOT NULL,
	"contracts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sepa" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"relationships" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"member_abteilungen" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sollstellungen" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"byte_size" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshot_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger" "snapshot_trigger" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"member_count" integer DEFAULT 0 NOT NULL,
	"bytes_total" integer DEFAULT 0 NOT NULL,
	"actor_id" text,
	"actor_email" text,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "member_snapshots" ADD CONSTRAINT "member_snapshots_run_id_snapshot_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."snapshot_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_snapshots" ADD CONSTRAINT "member_snapshots_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_snapshots" ADD CONSTRAINT "member_snapshots_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_snapshots" ADD CONSTRAINT "member_snapshots_audit_id_audit_log_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audit_log"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_runs" ADD CONSTRAINT "snapshot_runs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "snapshots_member_created_idx" ON "member_snapshots" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "snapshots_run_idx" ON "member_snapshots" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "snapshots_member_hash_idx" ON "member_snapshots" USING btree ("member_id","content_hash");--> statement-breakpoint
CREATE INDEX "snapshot_runs_trigger_idx" ON "snapshot_runs" USING btree ("trigger","started_at");--> statement-breakpoint
CREATE INDEX "snapshot_runs_started_idx" ON "snapshot_runs" USING btree ("started_at");