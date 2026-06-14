ALTER TABLE "fee_types" ADD COLUMN "antrags_rolle" text;--> statement-breakpoint
ALTER TABLE "membership_applications" ADD COLUMN "vorgeschlagene_art" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "fee_types_antrags_rolle_uk" ON "fee_types" USING btree ("antrags_rolle") WHERE "fee_types"."antrags_rolle" is not null;