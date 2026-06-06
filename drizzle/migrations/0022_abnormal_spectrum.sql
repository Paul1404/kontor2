CREATE TYPE "public"."member_status" AS ENUM('aktiv', 'passiv', 'ausgetreten', 'verstorben');--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "mitgliedsnummer" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "status" "member_status";--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "dunning_blocked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "members_mitgliedsnummer_idx" ON "members" USING btree ("mitgliedsnummer");--> statement-breakpoint
CREATE INDEX "members_status_idx" ON "members" USING btree ("status");