-- Custom SQL migration file, put your code below! --

-- One-time renumbering: give every live member/contact an app-owned opaque
-- number (added in 0031). Rows that carry a legacy Linear member number
-- (`mitgliedsnummer`) are real members and get an `M-` code in `member_no`;
-- rows without one are non-member contacts/payers and get a `K-` code in
-- `kontakt_no`. This mirrors the generator in `~/server/domain/member-number`.
--
-- The old Linear numbers are left untouched: `mitgliedsnummer` stays as the
-- preserved, searchable legacy number and `adr_nr` stays as internal join
-- plumbing. The full Linear row also survives in `member_source_records.raw`,
-- so no provenance is lost by renumbering.
--
-- Only non-deleted rows are numbered. Soft-deleted rows keep NULL numbers so a
-- deleted member frees its number (the partial unique indexes ignore them).
DO $$
DECLARE
  r record;
  alphabet text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';  -- Crockford base32 minus I,L,O,U
  body text;
  code text;
  i int;
  is_member boolean;
BEGIN
  FOR r IN SELECT id, mitgliedsnummer FROM "members" WHERE deleted_at IS NULL LOOP
    is_member := nullif(btrim(r.mitgliedsnummer), '') IS NOT NULL;
    LOOP
      body := '';
      FOR i IN 1..6 LOOP
        body := body || substr(alphabet, 1 + floor(random() * 32)::int, 1);
      END LOOP;
      code := (CASE WHEN is_member THEN 'M-' ELSE 'K-' END) || body;
      BEGIN
        IF is_member THEN
          UPDATE "members" SET "member_no" = code WHERE id = r.id;
        ELSE
          UPDATE "members" SET "kontakt_no" = code WHERE id = r.id;
        END IF;
        EXIT;  -- success, leave the retry loop
      EXCEPTION WHEN unique_violation THEN
        -- collision on the partial unique index: regenerate and retry
      END;
    END LOOP;
  END LOOP;
END $$;
