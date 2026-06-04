ALTER TABLE "kulanz_letters" ADD COLUMN "doc_ref" text;--> statement-breakpoint
CREATE UNIQUE INDEX "kulanz_letters_doc_ref_idx" ON "kulanz_letters" USING btree ("doc_ref");