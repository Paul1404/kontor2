CREATE TABLE "member_source_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"adr_nr" integer NOT NULL,
	"import_batch_id" uuid,
	"source_table" text DEFAULT 'adresse' NOT NULL,
	"raw" jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_source_records" ADD CONSTRAINT "member_source_records_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_source_records" ADD CONSTRAINT "member_source_records_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_source_records_member_idx" ON "member_source_records" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "member_source_records_adr_nr_idx" ON "member_source_records" USING btree ("adr_nr");