ALTER TABLE "attachments" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "member_snapshots" ADD COLUMN "families" jsonb DEFAULT '[]'::jsonb NOT NULL;