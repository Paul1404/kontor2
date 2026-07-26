ALTER TYPE "public"."soll_stellung_status" ADD VALUE 'pending' BEFORE 'open';--> statement-breakpoint
CREATE TABLE "setup_bootstrap_tokens" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "setup_bootstrap_tokens_token_hash_unique" UNIQUE("token_hash")
);
