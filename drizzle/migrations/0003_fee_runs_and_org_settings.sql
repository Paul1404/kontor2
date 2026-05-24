CREATE TYPE "public"."fee_run_status" AS ENUM('draft', 'committed', 'submitted', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."sepa_sequence_type" AS ENUM('FRST', 'RCUR', 'OOFF', 'FNAL');--> statement-breakpoint
CREATE TYPE "public"."soll_stellung_status" AS ENUM('open', 'paid', 'returned', 'cancelled');--> statement-breakpoint
CREATE TABLE "fee_run_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fee_run_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"sepa_mandate_id" uuid NOT NULL,
	"soll_stellung_id" uuid,
	"amount" numeric(19, 8) NOT NULL,
	"purpose" text NOT NULL,
	"includes_aufnahmegebuhr" boolean DEFAULT false NOT NULL,
	"end_to_end_id" text NOT NULL,
	"sequence_type" "sepa_sequence_type" NOT NULL,
	"mandate_ref" text NOT NULL,
	"mandate_signature_date" date,
	"debtor_name" text NOT NULL,
	"debtor_iban_last4" text NOT NULL,
	"debtor_bic" text,
	"returned_at" timestamp with time zone,
	"return_reason_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"billing_year" integer NOT NULL,
	"falligkeitsdatum" date NOT NULL,
	"status" "fee_run_status" DEFAULT 'draft' NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"total_amount" numeric(19, 8) DEFAULT '0' NOT NULL,
	"xml_message_id" text,
	"xml_payment_info_id_frst" text,
	"xml_payment_info_id_rcur" text,
	"xml_generated_at" timestamp with time zone,
	"xml_filename" text,
	"xml_content" text,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone,
	"committed_by" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text
);
--> statement-breakpoint
CREATE TABLE "soll_stellungen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"billing_year" integer NOT NULL,
	"falligkeitsdatum" date NOT NULL,
	"amount" numeric(19, 8) NOT NULL,
	"paid_amount" numeric(19, 8) DEFAULT '0' NOT NULL,
	"open_amount" numeric(19, 8) NOT NULL,
	"mahnstufe" integer DEFAULT 0 NOT NULL,
	"status" "soll_stellung_status" DEFAULT 'open' NOT NULL,
	"last_fee_run_item_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"vereinsname" text NOT NULL,
	"anschrift_strasse" text,
	"anschrift_plz" text,
	"anschrift_ort" text,
	"anschrift_land" text DEFAULT 'DE' NOT NULL,
	"glaeubiger_id" text NOT NULL,
	"vereins_iban" "bytea" NOT NULL,
	"vereins_iban_last4" text NOT NULL,
	"vereins_bic" text NOT NULL,
	"vereins_bankname" text,
	"default_falligkeit_tag" integer DEFAULT 15 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "fee_run_items" ADD CONSTRAINT "fee_run_items_fee_run_id_fee_runs_id_fk" FOREIGN KEY ("fee_run_id") REFERENCES "public"."fee_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_run_items" ADD CONSTRAINT "fee_run_items_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_run_items" ADD CONSTRAINT "fee_run_items_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_run_items" ADD CONSTRAINT "fee_run_items_sepa_mandate_id_sepa_mandates_id_fk" FOREIGN KEY ("sepa_mandate_id") REFERENCES "public"."sepa_mandates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_runs" ADD CONSTRAINT "fee_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_runs" ADD CONSTRAINT "fee_runs_committed_by_users_id_fk" FOREIGN KEY ("committed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_runs" ADD CONSTRAINT "fee_runs_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soll_stellungen" ADD CONSTRAINT "soll_stellungen_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soll_stellungen" ADD CONSTRAINT "soll_stellungen_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fee_run_items_run_idx" ON "fee_run_items" USING btree ("fee_run_id");--> statement-breakpoint
CREATE INDEX "fee_run_items_member_idx" ON "fee_run_items" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "fee_run_items_contract_idx" ON "fee_run_items" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "fee_runs_year_idx" ON "fee_runs" USING btree ("billing_year");--> statement-breakpoint
CREATE INDEX "fee_runs_status_idx" ON "fee_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "fee_runs_created_idx" ON "fee_runs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "soll_stellungen_contract_year_uk" ON "soll_stellungen" USING btree ("contract_id","billing_year");--> statement-breakpoint
CREATE INDEX "soll_stellungen_member_idx" ON "soll_stellungen" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "soll_stellungen_status_idx" ON "soll_stellungen" USING btree ("status");