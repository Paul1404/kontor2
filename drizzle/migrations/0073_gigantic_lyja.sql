ALTER TABLE "organization_settings" ADD COLUMN "tenant_policy" jsonb;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "canonical_host" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "legacy_hosts" text[] DEFAULT '{}'::text[] NOT NULL;