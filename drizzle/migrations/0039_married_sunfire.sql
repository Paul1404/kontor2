CREATE TYPE "public"."ehrung_kind" AS ENUM('vereinsjubilaeum', 'sonderehrung');--> statement-breakpoint
CREATE TABLE "ehrungen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" "ehrung_kind" NOT NULL,
	"jubilaeum_jahre" integer,
	"titel" text NOT NULL,
	"verliehen_am" date NOT NULL,
	"jahr" integer NOT NULL,
	"notiz" text,
	"urkunde_doc_ref" text,
	"urkunde_s3_key" text,
	"urkunde_filename" text,
	"urkunde_erstellt_am" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"created_by_email" text,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ehrungen" ADD CONSTRAINT "ehrungen_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ehrungen_member_idx" ON "ehrungen" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "ehrungen_jahr_idx" ON "ehrungen" USING btree ("jahr");--> statement-breakpoint
CREATE UNIQUE INDEX "ehrungen_member_jubilaeum_uk" ON "ehrungen" USING btree ("member_id","jubilaeum_jahre") WHERE "ehrungen"."jubilaeum_jahre" is not null and "ehrungen"."deleted_at" is null;