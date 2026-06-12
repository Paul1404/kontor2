CREATE TABLE "data_quality_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"member_id" uuid NOT NULL,
	"reason" text,
	"created_by" text,
	"created_by_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "data_quality_exceptions" ADD CONSTRAINT "data_quality_exceptions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dq_exceptions_category_member_uk" ON "data_quality_exceptions" USING btree ("category","member_id");--> statement-breakpoint
CREATE INDEX "dq_exceptions_member_idx" ON "data_quality_exceptions" USING btree ("member_id");