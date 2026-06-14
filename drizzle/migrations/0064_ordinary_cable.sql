ALTER TABLE "organization_settings" ADD COLUMN "kategorie_kind_max_alter" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "kategorie_jugendlich_max_alter" integer DEFAULT 18 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "kategorie_junger_erwachsener_max_alter" integer DEFAULT 25 NOT NULL;