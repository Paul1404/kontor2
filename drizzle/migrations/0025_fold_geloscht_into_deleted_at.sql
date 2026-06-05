-- Custom SQL migration file, put your code below! --

-- Soft-delete unification: fold the legacy Linear `geloscht` flag into the
-- app's single `deleted_at`. One-time backfill for rows already imported; the
-- importer folds it going forward, and consumers now check `deleted_at` alone.
--
-- `now()` is the honest timestamp: Linear never recorded when a member was
-- deleted, so the retention clock (used by the danger-zone purge) starts at the
-- fold. Only rows not already app-deleted are touched, so an existing
-- `deleted_at` is never overwritten.
UPDATE "members"
SET "deleted_at" = now()
WHERE coalesce("geloscht", false) = true
  AND "deleted_at" IS NULL;
