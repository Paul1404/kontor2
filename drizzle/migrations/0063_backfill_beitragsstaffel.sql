-- Freeze the current Beitragsstaffel for existing tenants.
--
-- The code used to fall back to a hardcoded SVU schedule when a tenant had no
-- `beitragsstaffel` configured, which silently billed SVU's prices to anyone
-- who never set their own. That fallback is being removed; this backfill writes
-- SVU's previous effective values into any row that is still NULL, so an
-- existing tenant keeps exactly the schedule it had. A freshly provisioned
-- tenant has no organization_settings row yet (the singleton is created when the
-- Vorstand fills in Stammdaten), so this UPDATE affects zero rows there and new
-- tenants start without a baked-in SVU schedule.
UPDATE "organization_settings"
SET "beitragsstaffel" = '{
  "familie": "96.00",
  "kind": "24.00",
  "kindElternMitglied": "12.00",
  "jugendlich": "36.00",
  "jugendlichElternMitglied": "24.00",
  "jungerErwachsener": "42.00",
  "erwachsener": "54.00"
}'::jsonb
WHERE "beitragsstaffel" IS NULL;
