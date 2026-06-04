-- Custom SQL migration file, put your code below! --

-- Backfill `contracts.is_direct_debit` from the raw Linear columns using the
-- same rule as `paysByDirectDebit`: a contract pays by direct debit unless it
-- is an explicit invoice payer (`auf_rechnung = 'J'`) or `lastschrift` is set
-- to an explicit non-"J" value. A blank `lastschrift` counts as direct debit,
-- the way Linear stores it. This closes the gap between the schema default
-- (false) and the next full re-import that would otherwise repopulate it.
UPDATE "contracts"
SET "is_direct_debit" = (
  upper(coalesce(trim("auf_rechnung"), '')) <> 'J'
  AND coalesce(nullif(upper(trim("lastschrift")), ''), 'J') = 'J'
);
