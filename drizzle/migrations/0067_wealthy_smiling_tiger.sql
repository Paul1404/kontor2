CREATE TYPE "public"."linear_archive_status" AS ENUM('parsing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "linear_archive_columns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"table_name" text NOT NULL,
	"ordinal" integer NOT NULL,
	"name" text NOT NULL,
	"data_type" text,
	"base_type" text,
	"nullable" boolean DEFAULT true NOT NULL,
	"default_value" text,
	"is_primary_key" boolean DEFAULT false NOT NULL,
	"is_indexed" boolean DEFAULT false NOT NULL,
	"null_count" integer DEFAULT 0 NOT NULL,
	"distinct_count" integer DEFAULT 0 NOT NULL,
	"distinct_capped" boolean DEFAULT false NOT NULL,
	"min_text" text,
	"max_text" text,
	"sample_values" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "linear_archive_rows" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"version_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"table_name" text NOT NULL,
	"row_index" integer NOT NULL,
	"data" jsonb NOT NULL,
	"search_text" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "linear_archive_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"table_name" text NOT NULL,
	"create_sql" text NOT NULL,
	"column_count" integer DEFAULT 0 NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"primary_key" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "linear_archive_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"filename" text NOT NULL,
	"file_size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"status" "linear_archive_status" DEFAULT 'parsing' NOT NULL,
	"table_count" integer DEFAULT 0 NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"errors" jsonb,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"created_by_email" text
);
--> statement-breakpoint
ALTER TABLE "linear_archive_columns" ADD CONSTRAINT "linear_archive_columns_table_id_linear_archive_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."linear_archive_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_archive_columns" ADD CONSTRAINT "linear_archive_columns_version_id_linear_archive_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."linear_archive_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_archive_rows" ADD CONSTRAINT "linear_archive_rows_version_id_linear_archive_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."linear_archive_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_archive_rows" ADD CONSTRAINT "linear_archive_rows_table_id_linear_archive_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."linear_archive_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_archive_tables" ADD CONSTRAINT "linear_archive_tables_version_id_linear_archive_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."linear_archive_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_archive_versions" ADD CONSTRAINT "linear_archive_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "linear_archive_columns_table_idx" ON "linear_archive_columns" USING btree ("table_id","ordinal");--> statement-breakpoint
CREATE INDEX "linear_archive_columns_version_name_idx" ON "linear_archive_columns" USING btree ("version_id","table_name");--> statement-breakpoint
CREATE INDEX "linear_archive_rows_table_idx" ON "linear_archive_rows" USING btree ("table_id","row_index");--> statement-breakpoint
CREATE INDEX "linear_archive_rows_version_table_idx" ON "linear_archive_rows" USING btree ("version_id","table_name");--> statement-breakpoint
CREATE UNIQUE INDEX "linear_archive_tables_version_name_uk" ON "linear_archive_tables" USING btree ("version_id","table_name");--> statement-breakpoint
CREATE INDEX "linear_archive_tables_version_idx" ON "linear_archive_tables" USING btree ("version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "linear_archive_versions_version_uk" ON "linear_archive_versions" USING btree ("version");--> statement-breakpoint
CREATE INDEX "linear_archive_versions_created_idx" ON "linear_archive_versions" USING btree ("created_at");