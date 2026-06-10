-- Custom SQL migration file, put your code below! --

-- aktiv/passiv is no longer stored on `members.status`. It is derived on read
-- from the member's active Abteilungen: a live member with no active membership
-- in a real Abteilung (not the "Keine Abteilung" sentinel) is passiv, otherwise
-- aktiv. `deriveStatus` no longer emits `passiv`, so the stored column carries
-- only the lifecycle axis (aktiv / ausgetreten / verstorben).
--
-- Collapse the now-unused stored `passiv` value into the lifecycle `aktiv`.
-- A future re-import writes the same value, so this is idempotent and safe to
-- re-run. The `passiv` enum value is kept (not dropped) to avoid an enum
-- migration; nothing writes it anymore.
UPDATE "members" SET "status" = 'aktiv' WHERE "status" = 'passiv';
