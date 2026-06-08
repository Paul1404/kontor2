CREATE TYPE "public"."member_task_status" AS ENUM('open', 'done');--> statement-breakpoint
CREATE TABLE "member_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"due_date" date,
	"status" "member_task_status" DEFAULT 'open' NOT NULL,
	"created_by" text,
	"created_by_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_email" text
);
--> statement-breakpoint
ALTER TABLE "member_tasks" ADD CONSTRAINT "member_tasks_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_tasks_member_idx" ON "member_tasks" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "member_tasks_status_due_idx" ON "member_tasks" USING btree ("status","due_date");