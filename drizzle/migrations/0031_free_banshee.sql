ALTER TABLE "members" ADD COLUMN "member_no" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "kontakt_no" text;--> statement-breakpoint
CREATE UNIQUE INDEX "members_member_no_uk" ON "members" USING btree ("member_no") WHERE "members"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "members_kontakt_no_uk" ON "members" USING btree ("kontakt_no") WHERE "members"."deleted_at" is null;