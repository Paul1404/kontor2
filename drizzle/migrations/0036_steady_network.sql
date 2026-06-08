ALTER TABLE "invitations" DROP CONSTRAINT "invitations_token_unique";--> statement-breakpoint
ALTER TABLE "invitations" ALTER COLUMN "token" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "token_hash" text;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash");