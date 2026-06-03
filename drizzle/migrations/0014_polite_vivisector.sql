CREATE TABLE "cancellation_letters" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" uuid,
	"display_name" text NOT NULL,
	"austritt_datum" text NOT NULL,
	"mitgliedsnummer" text,
	"abteilung" text,
	"is_family" boolean DEFAULT false NOT NULL,
	"familienmitglieder" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"empfaenger_abweichend" boolean DEFAULT false NOT NULL,
	"s3_key" text NOT NULL,
	"filename" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "kontakt_email" text;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "kontakt_telefon" text;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "datenschutz_url" text;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "satzung_url" text;--> statement-breakpoint
ALTER TABLE "cancellation_letters" ADD CONSTRAINT "cancellation_letters_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_letters" ADD CONSTRAINT "cancellation_letters_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cancellation_letters_member_idx" ON "cancellation_letters" USING btree ("member_id");