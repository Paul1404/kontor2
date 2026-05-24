CREATE TABLE "relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_member_id" uuid NOT NULL,
	"to_member_id" uuid,
	"from_adr_nr" integer NOT NULL,
	"to_adr_nr" integer NOT NULL,
	"beziehung" text,
	"matchcode" text,
	"name" text,
	"anrede" text,
	"telefon" text,
	"abteilung" text,
	"nachname" text,
	"art" text,
	"art_name" text,
	"rg" text,
	"funktion" text,
	"post" text,
	"fax" text,
	"email" text,
	"eb" text,
	"vkennung" text,
	"dat_von" timestamp,
	"dat_bis" timestamp,
	"v_email" text,
	"kennung_v1" text,
	"kennung_v2" text,
	"kennung_v3" text,
	"kennung_v4" text,
	"kennung_v5" text,
	"notiz" text,
	"import_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "relationships_written" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_from_member_id_members_id_fk" FOREIGN KEY ("from_member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_to_member_id_members_id_fk" FOREIGN KEY ("to_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "relationships_from_to_adrnr_uk" ON "relationships" USING btree ("from_adr_nr","to_adr_nr");--> statement-breakpoint
CREATE INDEX "relationships_from_member_idx" ON "relationships" USING btree ("from_member_id");--> statement-breakpoint
CREATE INDEX "relationships_to_member_idx" ON "relationships" USING btree ("to_member_id");