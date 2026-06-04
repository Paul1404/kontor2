CREATE TABLE "document_sequences" (
	"prefix" text NOT NULL,
	"year" integer NOT NULL,
	"last_seq" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "document_sequences_prefix_year_pk" PRIMARY KEY("prefix","year")
);
--> statement-breakpoint
ALTER TABLE "cancellation_letters" ADD COLUMN "doc_ref" text;--> statement-breakpoint
ALTER TABLE "dsgvo_requests" ADD COLUMN "doc_ref" text;--> statement-breakpoint
ALTER TABLE "dunning_items" ADD COLUMN "doc_ref" text;--> statement-breakpoint
CREATE UNIQUE INDEX "cancellation_letters_doc_ref_idx" ON "cancellation_letters" USING btree ("doc_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "dsgvo_requests_doc_ref_idx" ON "dsgvo_requests" USING btree ("doc_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "dunning_items_doc_ref_idx" ON "dunning_items" USING btree ("doc_ref");