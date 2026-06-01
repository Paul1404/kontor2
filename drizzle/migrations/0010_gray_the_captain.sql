ALTER TABLE "organization_settings" ADD COLUMN "beitrag_modus" text DEFAULT 'voll' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "anteil_einheit" text DEFAULT 'monat' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "kuendigungsfrist_aktiv" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "kuendigungsfrist_tage" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "kuendigung_zum_monatsende" boolean DEFAULT false NOT NULL;