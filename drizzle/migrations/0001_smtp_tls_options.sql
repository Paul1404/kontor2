ALTER TABLE "smtp_config" ADD COLUMN "require_tls" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "smtp_config" ADD COLUMN "allow_invalid_certs" boolean DEFAULT false NOT NULL;