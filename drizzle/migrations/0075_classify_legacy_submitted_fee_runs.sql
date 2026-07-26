-- Before the explicit submission workflow existed, creating an XML-bearing
-- run immediately classified its postings as collected. Preserve that historic
-- meaning by marking those runs submitted. Invoice-only committed runs have no
-- XML and stay committed/cancellable.
UPDATE "fee_runs"
SET "status" = 'submitted'
WHERE "status" = 'committed'
  AND "xml_content" IS NOT NULL;
