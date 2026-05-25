CREATE TYPE "public"."fee_run_source" AS ENUM('app', 'linear_import');--> statement-breakpoint
CREATE TABLE "fee_type_price_history" (
	"art" integer NOT NULL,
	"jahr" integer NOT NULL,
	"monat" integer NOT NULL,
	"betrag" numeric(19, 8),
	"prozent" numeric(19, 8),
	"datum" date,
	CONSTRAINT "fee_type_price_history_art_jahr_monat_pk" PRIMARY KEY("art","jahr","monat")
);
--> statement-breakpoint
CREATE TABLE "legacy_sepa_run_items" (
	"sepa_guid" text NOT NULL,
	"soll_guid" text NOT NULL,
	"betrag" numeric(19, 8),
	"offen" numeric(19, 8),
	"ruck_last_guid" text,
	"archived" text DEFAULT 'false' NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_sepa_run_items_sepa_guid_soll_guid_pk" PRIMARY KEY("sepa_guid","soll_guid")
);
--> statement-breakpoint
CREATE TABLE "legacy_sepa_runs" (
	"id" integer PRIMARY KEY NOT NULL,
	"datum" timestamp NOT NULL,
	"falligkeitsdatum" timestamp,
	"benutzer" text NOT NULL,
	"guid" text NOT NULL,
	"xml_name" text NOT NULL,
	"xml_data" text,
	"archived" text DEFAULT 'false' NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "linear_federations" (
	"kz" text NOT NULL,
	"nummer" text NOT NULL,
	"fachverband" text,
	"kn" text,
	"lfd_nr" integer NOT NULL,
	CONSTRAINT "linear_federations_kz_nummer_lfd_nr_pk" PRIMARY KEY("kz","nummer","lfd_nr")
);
--> statement-breakpoint
CREATE TABLE "linear_sport_types" (
	"kz" text NOT NULL,
	"nummer" text NOT NULL,
	"sportart" text,
	"verband_nr" text,
	"lfd_nr" integer NOT NULL,
	CONSTRAINT "linear_sport_types_kz_nummer_lfd_nr_pk" PRIMARY KEY("kz","nummer","lfd_nr")
);
--> statement-breakpoint
ALTER TABLE "fee_runs" ADD COLUMN "source" "fee_run_source" DEFAULT 'app' NOT NULL;--> statement-breakpoint
ALTER TABLE "fee_runs" ADD COLUMN "linear_guid" text;--> statement-breakpoint
ALTER TABLE "soll_stellungen" ADD COLUMN "source" "fee_run_source" DEFAULT 'app' NOT NULL;--> statement-breakpoint
ALTER TABLE "soll_stellungen" ADD COLUMN "linear_guid" text;--> statement-breakpoint
CREATE INDEX "legacy_sepa_run_items_soll_idx" ON "legacy_sepa_run_items" USING btree ("soll_guid");--> statement-breakpoint
CREATE INDEX "legacy_sepa_runs_guid_idx" ON "legacy_sepa_runs" USING btree ("guid");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_runs_linear_guid_uk" ON "fee_runs" USING btree ("linear_guid");--> statement-breakpoint
CREATE INDEX "soll_stellungen_linear_guid_idx" ON "soll_stellungen" USING btree ("linear_guid");