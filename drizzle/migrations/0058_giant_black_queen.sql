ALTER TABLE "tenants" ALTER COLUMN "database_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "database_name" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_target_present" CHECK ("database_name" is not null or "database_url" is not null);