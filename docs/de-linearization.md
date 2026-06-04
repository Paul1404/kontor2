# De-Linearization

How we get Linear Webverein's data model out of our runtime without giving up
the import. This is a decision record, not a tutorial. Read it before touching
the importer or the direct-debit / soft-delete / member-identity logic.

## The goal in one sentence

The importer should be the **only** place that knows Linear exists. Every Linear
quirk gets translated into a clean shape at the import edge; the rest of the app
reads normal columns and never reinterprets a Linear representation at runtime.

Litmus test: *could a new dev build a feature here without learning anything
about Linear?* The closer to "yes", the better the boundary.

## Where we are

We are in a **parallel run / shadow phase**. Linear is still the system of
record. svuwv shadows it and is re-imported repeatedly while we dogfood. That is
a deliberate, correct migration pattern, not a smell.

Two structural facts about the importer that you must respect:

1. **Contracts are replace-not-upsert.** `runIngest` deletes and re-inserts
   contracts (and SEPA mandates, relationships) for every AdrNr in the dump, so
   contract UUIDs churn on every import. `soll_stellungen.contract_id` is an FK
   with `ON DELETE CASCADE`, so **a re-import cascade-deletes every posting
   hanging off those contracts** and rebuilds only what Linear's `mgsolln`
   contains. Consequence: any fee run, posting, or SEPA action generated *in
   svuwv* is destroyed on the next import. During the shadow phase, svuwv's
   financial state is structurally disposable. This is fine now (it lets us
   iterate fearlessly), but it is a hard gate on cutover (below).

2. **`deleted_at` survives import.** The member upsert does `.set({ ...row })`,
   and the mapper never emits `deleted_at`, so app-side soft-deletes are
   preserved across re-imports. This is the one piece of app state that is safe
   today. Member fields the app can edit (address, email, etc.) are otherwise
   clobbered back to Linear on re-import.

## The cutover gate

The shadow phase ends with a **one-shot cutover**: a final import, then Linear
goes dark and svuwv becomes the system of record. Because of fact (1) above,
**the day you start trusting svuwv's financial state is the day you must stop
running the importer.** Re-importing after that point will cascade-delete
app-authored postings. Before cutover, retire or gate the importer's refresh
role so it cannot run by accident.

Because the data rebuilds itself on every import, normalization changes are
cheap right now: change the mapper, re-import, done. No careful one-time
migration ceremony. Use this window.

## How to de-Linearize one quirk (the template)

Each leaked invariant follows the same shape:

1. **Normalize at the edge.** Compute the clean value in `linear-mapper.ts` and
   store it in a derived column. Keep the raw Linear column(s) as provenance.
2. **Read the clean column at runtime.** Delete the runtime special-case that
   reinterpreted the raw Linear columns.
3. **Backfill** existing rows with a migration (so it is correct before the next
   re-import), and **add a test** asserting the mapper sets the derived value
   and the old branch is gone.

## Status

### Done: `lastschrift` -> `contracts.is_direct_debit`

Linear leaves `mgvert.Lastschrift` blank for the common direct-debit case, so
"blank means direct debit". This was reinterpreted at runtime in two places
(the fee-run builder and the dunning reconciliation).

- `paysByDirectDebit` (in `~/server/sepa/direct-debit`) is now called **only**
  by the importer; it populates the new `contracts.is_direct_debit` boolean.
- The fee-run builder reads `contract.isDirectDebit`; the dunning queries read
  `eq(contracts.is_direct_debit, true)`. The old `directDebitSql` runtime
  predicate is deleted.
- Migration `0016` adds the column; `0017` backfills it with the same rule.

This is the worked example of the template above.

### Next: `geloscht` -> `deleted_at`

Linear's `geloscht` boolean is carried raw and checked alongside `deleted_at` in
every report/query (two flags to remember; forgetting one leaks deleted members
into money totals). Fold it into `deleted_at` at import time.

Subtlety: import-managed deletion and app-managed deletion must stay
distinguishable, or a re-import will fight the UI (e.g. a member un-deleted in
Linear should not silently revive one an admin removed in svuwv). This needs a
two-source delete model, not a blind assignment. Do not ship this as a one-line
change.

### Next: `mitglnr` / `adr_nr` -> one identifier space

A member is either a real member (`mitglnr`) or a legacy contact (`adr_nr`
only), and routing/lookups branch on which one exists. Assign every contact a
stable public identifier so the `mitglnr ?? adrNr ?? uuid` fallback collapses to
a single lookup. Mostly display/routing, but it touches identity broadly, so
scope it deliberately.
