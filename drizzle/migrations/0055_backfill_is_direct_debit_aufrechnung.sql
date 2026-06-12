-- Custom SQL migration file, put your code below! --

-- Re-derive `contracts.is_direct_debit` to match the corrected `paysByDirectDebit`
-- rule: the ONLY invoice marker is `auf_rechnung = 'J'`; every other contract
-- pays by direct debit. The previous derivation (migration 0017) wrongly
-- treated any non-blank, non-"J" `lastschrift` as "not direct debit", which
-- flagged Linear's `'L'` (= Lastschrift) and `'B'` contracts as invoice payers.
-- That made the Zahlart tile show "Rechnung" for ~37 members although the club
-- offers no invoice payment (0 contracts carry `auf_rechnung = 'J'`).
UPDATE "contracts"
SET "is_direct_debit" = (upper(coalesce(trim("auf_rechnung"), '')) <> 'J');
