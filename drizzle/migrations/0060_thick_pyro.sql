CREATE TABLE "document_refs" (
	"ref" text PRIMARY KEY NOT NULL,
	"prefix" text NOT NULL,
	"year" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
