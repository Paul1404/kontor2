CREATE TABLE "data_quality_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_date" date NOT NULL,
	"rule_id" text NOT NULL,
	"severity" text NOT NULL,
	"count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "dq_snapshots_date_rule_uk" ON "data_quality_snapshots" USING btree ("snapshot_date","rule_id");--> statement-breakpoint
CREATE INDEX "dq_snapshots_date_idx" ON "data_quality_snapshots" USING btree ("snapshot_date");