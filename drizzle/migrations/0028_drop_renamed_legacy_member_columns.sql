DROP INDEX "members_mitglnr_idx";--> statement-breakpoint
DROP INDEX "members_email_name_idx";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "mahn_sperre";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "mitglnr";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "aktiv";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "aktiv_pasiv";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "telefon3";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "e_mail_name";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "mandatsrefenz";