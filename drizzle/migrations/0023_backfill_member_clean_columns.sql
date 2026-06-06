-- Custom SQL migration file, put your code below! --

-- One-time backfill of the clean, app-owned member columns added in 0022 from
-- the legacy Linear columns. The rules here mirror the normalizations in
-- `~/server/domain/member` (deriveStatus, isDunningBlocked, memberRef) and the
-- importer translator (`translateLinearMember`), so the backfilled values match
-- what a fresh import would write. Legacy columns are left untouched; nothing
-- reads the clean columns yet (consumers are cut over in a later phase).
UPDATE "members"
SET
  -- mitglnr -> mitgliedsnummer (trim, empty becomes NULL)
  "mitgliedsnummer" = nullif(btrim("mitglnr"), ''),
  -- e_mail_name, falling back to telefon3 the way Linear stored some emails
  "email" = coalesce(nullif(btrim("e_mail_name"), ''), nullif(btrim("telefon3"), '')),
  -- aktiv_pasiv + exit/death dates -> normalized status enum.
  -- Precedence: a recorded death wins, then an exit, then the A/P flag.
  "status" = (
    CASE
      WHEN "verstorben_am" IS NOT NULL THEN 'verstorben'
      WHEN "austritt" IS NOT NULL THEN 'ausgetreten'
      WHEN upper(btrim(coalesce("aktiv_pasiv", ''))) = 'P' THEN 'passiv'
      ELSE 'aktiv'
    END
  )::"public"."member_status",
  -- mahn_sperre text flag -> boolean. Empty/whitespace and the sentinel '0'
  -- mean "not blocked"; anything else blocks dunning.
  "dunning_blocked" = (
    "mahn_sperre" IS NOT NULL
    AND btrim("mahn_sperre") <> ''
    AND btrim("mahn_sperre") <> '0'
  );
