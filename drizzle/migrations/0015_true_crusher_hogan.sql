CREATE TABLE "kulanz_letters" (
	"id" text PRIMARY KEY NOT NULL,
	"run_date" text NOT NULL,
	"deadline_date" text NOT NULL,
	"recipient_count" integer NOT NULL,
	"total_open" numeric(19, 2) NOT NULL,
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"s3_key" text NOT NULL,
	"filename" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
ALTER TABLE "kulanz_letters" ADD CONSTRAINT "kulanz_letters_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kulanz_letters_created_idx" ON "kulanz_letters" USING btree ("created_at");