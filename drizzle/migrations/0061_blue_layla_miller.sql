ALTER TABLE "fee_run_items" ADD COLUMN "zahler_member_id" uuid;--> statement-breakpoint
ALTER TABLE "soll_stellungen" ADD COLUMN "fee_run_id" uuid;--> statement-breakpoint
ALTER TABLE "fee_run_items" ADD CONSTRAINT "fee_run_items_zahler_member_id_members_id_fk" FOREIGN KEY ("zahler_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soll_stellungen" ADD CONSTRAINT "soll_stellungen_fee_run_id_fee_runs_id_fk" FOREIGN KEY ("fee_run_id") REFERENCES "public"."fee_runs"("id") ON DELETE set null ON UPDATE no action;