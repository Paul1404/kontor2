DROP INDEX "member_source_records_member_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "member_source_records_member_source_uk" ON "member_source_records" USING btree ("member_id","source_table");