-- Custom SQL migration file, put your code below! --

-- One-time backfill: the Rücklastschriftgebühr (`sepa_return_fee`) used to
-- default to 0, which meant the Kulanz-Brief never printed a SEPA-Gebühr out of
-- the box. The default is now 3,00 € (the usual bank Rücklastschriftentgelt),
-- so lift the existing singleton row to the same value -- but only when it still
-- carries the old 0 default, so an intentionally configured amount is never
-- clobbered.
UPDATE "organization_settings"
SET "sepa_return_fee" = '3.00'
WHERE "sepa_return_fee" = 0;
