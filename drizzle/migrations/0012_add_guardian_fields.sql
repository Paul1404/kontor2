ALTER TABLE "members" ADD COLUMN "vertreter_anrede" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "vertreter_name" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "vertreter_strasse" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "vertreter_hausnummer" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "vertreter_plz" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "vertreter_ort" text;--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "ist_vertreter" boolean DEFAULT false NOT NULL;