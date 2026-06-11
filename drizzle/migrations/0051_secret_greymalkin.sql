CREATE TYPE "public"."familien_rolle" AS ENUM('zahler', 'partner', 'kind');--> statement-breakpoint
CREATE TABLE "familien_mitglieder" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"familie_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"rolle" "familien_rolle" NOT NULL,
	"von" date,
	"bis" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "familien" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"zahler_member_id" uuid,
	"notiz" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "familien_mitglieder" ADD CONSTRAINT "familien_mitglieder_familie_id_familien_id_fk" FOREIGN KEY ("familie_id") REFERENCES "public"."familien"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "familien_mitglieder" ADD CONSTRAINT "familien_mitglieder_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "familien" ADD CONSTRAINT "familien_zahler_member_id_members_id_fk" FOREIGN KEY ("zahler_member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "familien_mitglieder_active_member_uk" ON "familien_mitglieder" USING btree ("member_id") WHERE bis is null;--> statement-breakpoint
CREATE INDEX "familien_mitglieder_familie_idx" ON "familien_mitglieder" USING btree ("familie_id");