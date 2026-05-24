CREATE TYPE "public"."geschlecht" AS ENUM('m', 'w', 'd', 'unbekannt');--> statement-breakpoint
ALTER TABLE "abteilungen" ADD COLUMN "sportart" text;--> statement-breakpoint
ALTER TABLE "abteilungen" ADD COLUMN "verband_name" text;--> statement-breakpoint
ALTER TABLE "abteilungen" ADD COLUMN "verband_nr" text;--> statement-breakpoint
ALTER TABLE "abteilungen" ADD COLUMN "inaktiv" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "geschlecht" "geschlecht";--> statement-breakpoint
-- Backfill geschlecht from anrede so existing rows don't read NULL.
-- Anything other than a clear "Herr"/"Frau" becomes 'unbekannt' rather
-- than guessing.
UPDATE "members"
SET "geschlecht" = CASE
  WHEN lower(trim("anrede")) = 'herr' THEN 'm'::geschlecht
  WHEN lower(trim("anrede")) = 'frau' THEN 'w'::geschlecht
  ELSE 'unbekannt'::geschlecht
END
WHERE "geschlecht" IS NULL;