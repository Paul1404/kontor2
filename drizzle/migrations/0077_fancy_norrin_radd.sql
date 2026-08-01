ALTER TABLE "email_log" ADD COLUMN "body_text" text;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "body_html" text;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "attachment_names" text[];