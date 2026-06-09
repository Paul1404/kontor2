CREATE TYPE "public"."fee_run_kind" AS ENUM('regular', 'recollection');--> statement-breakpoint
ALTER TABLE "fee_runs" ADD COLUMN "kind" "fee_run_kind" DEFAULT 'regular' NOT NULL;