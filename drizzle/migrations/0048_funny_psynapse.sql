-- Guarded pre-check (issue #78): refuse to apply while two non-deleted records
-- share a Mitgliedsnummer (observed live: 1272 ×2). We do NOT auto-merge — the
-- offending records must be resolved by hand first. The exception lists the
-- colliding numbers and the internal ids so the operator can find them.
DO $$
DECLARE
  collisions text;
BEGIN
  SELECT string_agg(
           format('%s -> [%s]', mitgliedsnummer, ids),
           '; '
         )
    INTO collisions
  FROM (
    SELECT mitgliedsnummer, string_agg(id::text, ', ' ORDER BY id) AS ids
    FROM members
    WHERE deleted_at IS NULL
      AND mitgliedsnummer IS NOT NULL
      AND btrim(mitgliedsnummer) <> ''
    GROUP BY mitgliedsnummer
    HAVING count(*) > 1
  ) dupes;

  IF collisions IS NOT NULL THEN
    RAISE EXCEPTION
      'Mitgliedsnummer-Kollision: % . Bitte diese Datensaetze vor der Migration manuell aufloesen (nicht automatisch zusammenfuehren).',
      collisions;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "members_mitgliedsnummer_uk" ON "members" USING btree ("mitgliedsnummer") WHERE "members"."deleted_at" is null;
