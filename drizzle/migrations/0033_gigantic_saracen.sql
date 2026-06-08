CREATE TYPE "public"."rundschreiben_recipient_status" AS ENUM('sent', 'failed');--> statement-breakpoint
CREATE TABLE "rundschreiben_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rundschreiben_id" uuid NOT NULL,
	"member_id" uuid,
	"email" text NOT NULL,
	"name" text,
	"status" "rundschreiben_recipient_status" NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rundschreiben" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"filter" jsonb,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_by_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rundschreiben_recipients" ADD CONSTRAINT "rundschreiben_recipients_rundschreiben_id_rundschreiben_id_fk" FOREIGN KEY ("rundschreiben_id") REFERENCES "public"."rundschreiben"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rundschreiben_recipients" ADD CONSTRAINT "rundschreiben_recipients_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rundschreiben_recipients_run_idx" ON "rundschreiben_recipients" USING btree ("rundschreiben_id");--> statement-breakpoint
CREATE INDEX "rundschreiben_created_idx" ON "rundschreiben" USING btree ("created_at");