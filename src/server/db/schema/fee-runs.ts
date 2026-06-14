import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "~/server/db/schema/auth";
import { contractsTable } from "~/server/db/schema/contracts";
import { membersTable } from "~/server/db/schema/members";
import { sepaMandatesTable } from "~/server/db/schema/sepa";

export const feeRunStatusEnum = pgEnum("fee_run_status", [
  "draft",
  "committed",
  "submitted",
  "cancelled",
]);

/**
 * Provenance marker on `fee_runs` / `soll_stellungen`. `app` is the in-app
 * lifecycle; `linear_import` rows arrive from a Linear Webverein dump and
 * exist mostly for historical reference (no fresh XML, no re-debit path).
 */
export const feeRunSourceEnum = pgEnum("fee_run_source", ["app", "linear_import"]);

/**
 * What a run is for. `regular` is the yearly Beitragslauf (and its catch-up
 * re-runs). `recollection` is a Wiedereinzug: a fresh pain.008 for postings
 * that already exist but came back as a Rücklastschrift, now with a corrected
 * IBAN / valid mandate. A recollection never creates Sollstellungen -- it
 * re-debits existing `returned` ones and flips them back to `eingezogen`.
 */
export const feeRunKindEnum = pgEnum("fee_run_kind", ["regular", "recollection"]);

export const sepaSequenceTypeEnum = pgEnum("sepa_sequence_type", ["FRST", "RCUR", "OOFF", "FNAL"]);

export const sollStellungStatusEnum = pgEnum("soll_stellung_status", [
  "open",
  "paid",
  "returned",
  "cancelled",
  // SEPA direct debit submitted to the bank and presumed collected (the bank
  // only reports failures, via Rücklastschrift). Not dunnable; a recorded
  // return flips it back to `returned`.
  "eingezogen",
]);

/**
 * Beitragslauf header. One row per run. Runs are incremental: a contract that
 * already has a live (non-cancelled) Sollstellung for the year is skipped, so
 * several committed runs can share a billing year -- the initial run plus
 * catch-up runs for members added or unblocked later. The `(contractId,
 * billingYear)` unique on `soll_stellungen` is what prevents double-billing.
 *
 * Mirrors Linear `lastprot` (Datum, Falligkeitsdatum, GUID, XMLName, XMLData).
 */
export const feeRunsTable = pgTable(
  "fee_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    billingYear: integer("billing_year").notNull(),
    falligkeitsdatum: date("falligkeitsdatum").notNull(),
    status: feeRunStatusEnum("status").notNull().default("draft"),
    kind: feeRunKindEnum("kind").notNull().default("regular"),
    itemCount: integer("item_count").notNull().default(0),
    totalAmount: numeric("total_amount", { precision: 19, scale: 8 }).notNull().default("0"),
    xmlMessageId: text("xml_message_id"),
    xmlPaymentInfoIdFrst: text("xml_payment_info_id_frst"),
    xmlPaymentInfoIdRcur: text("xml_payment_info_id_rcur"),
    xmlGeneratedAt: timestamp("xml_generated_at", { withTimezone: true }),
    xmlFilename: text("xml_filename"),
    xmlContent: text("xml_content"),
    notes: text("notes"),
    /** When the SEPA pre-notification (Vorabankündigung) emails were last sent. */
    prenotifiedAt: timestamp("prenotified_at", { withTimezone: true }),
    /** Provenance. `linear_import` rows aren't editable / re-submittable. */
    source: feeRunSourceEnum("source").notNull().default("app"),
    /**
     * Linear `lastprot.GUID` for imported runs. Natural key for idempotent
     * re-import; null for app-created rows.
     */
    linearGuid: text("linear_guid"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    committedBy: text("committed_by").references(() => users.id, { onDelete: "set null" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: text("cancelled_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("fee_runs_year_idx").on(t.billingYear),
    index("fee_runs_status_idx").on(t.status),
    index("fee_runs_created_idx").on(t.createdAt),
    uniqueIndex("fee_runs_linear_guid_uk").on(t.linearGuid),
  ],
);

/**
 * Per-debit line snapshot. Each row corresponds to one `DrctDbtTxInf`
 * element in the generated pain.008 XML. Debtor + mandate snapshot fields
 * keep the row meaningful even if the source mandate is later revoked.
 *
 * Mirrors Linear `lastprots`.
 */
export const feeRunItemsTable = pgTable(
  "fee_run_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    feeRunId: uuid("fee_run_id")
      .notNull()
      .references(() => feeRunsTable.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => membersTable.id, { onDelete: "restrict" }),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contractsTable.id, { onDelete: "restrict" }),
    sepaMandateId: uuid("sepa_mandate_id")
      .notNull()
      .references(() => sepaMandatesTable.id, { onDelete: "restrict" }),
    // Soft pointer (no FK) -- breaks the circular reference between
    // fee_run_items and soll_stellungen. Joined manually when needed.
    sollStellungId: uuid("soll_stellung_id"),
    // The account holder actually debited (family payer / guardian / explicit
    // Vertrags-Zahler), which may differ from the billed memberId. Used to send
    // the SEPA pre-notification to the right person. Nullable for rows written
    // before this column existed; readers fall back to memberId.
    zahlerMemberId: uuid("zahler_member_id").references(() => membersTable.id, {
      onDelete: "set null",
    }),
    amount: numeric("amount", { precision: 19, scale: 8 }).notNull(),
    purpose: text("purpose").notNull(),
    includesAufnahmegebuhr: boolean("includes_aufnahmegebuhr").notNull().default(false),
    endToEndId: text("end_to_end_id").notNull(),
    sequenceType: sepaSequenceTypeEnum("sequence_type").notNull(),
    mandateRef: text("mandate_ref").notNull(),
    mandateSignatureDate: date("mandate_signature_date"),
    debtorName: text("debtor_name").notNull(),
    debtorIbanLast4: text("debtor_iban_last4").notNull(),
    debtorBic: text("debtor_bic"),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    returnReasonCode: text("return_reason_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("fee_run_items_run_idx").on(t.feeRunId),
    index("fee_run_items_member_idx").on(t.memberId),
    index("fee_run_items_contract_idx").on(t.contractId),
  ],
);

/**
 * Open posting per (contract, billing year). Mirrors Linear `mgsolln`.
 * `openAmount` is maintained in code (amount - paidAmount) so future Phase 4
 * work can update it from camt.054 R-Transactions.
 *
 * Unique (contractId, billingYear) prevents duplicating a posting when the
 * same year is run multiple times -- re-runs upsert.
 */
export const sollStellungenTable = pgTable(
  "soll_stellungen",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => membersTable.id, { onDelete: "cascade" }),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contractsTable.id, { onDelete: "cascade" }),
    billingYear: integer("billing_year").notNull(),
    falligkeitsdatum: date("falligkeitsdatum").notNull(),
    amount: numeric("amount", { precision: 19, scale: 8 }).notNull(),
    paidAmount: numeric("paid_amount", { precision: 19, scale: 8 }).notNull().default("0"),
    openAmount: numeric("open_amount", { precision: 19, scale: 8 }).notNull(),
    mahnstufe: integer("mahnstufe").notNull().default(0),
    status: sollStellungStatusEnum("status").notNull().default("open"),
    // Soft pointer (no FK) -- the corresponding fee_run_item may be cascade
    // deleted with its fee_run; we keep this as a historical hint only.
    lastFeeRunItemId: uuid("last_fee_run_item_id"),
    // The fee run that created/last touched this posting. Lets Storno revert the
    // invoice-payer postings it produced (status "open", which have no
    // fee_run_item to revert through). Null for linear_import rows and manual
    // postings.
    feeRunId: uuid("fee_run_id").references(() => feeRunsTable.id, { onDelete: "set null" }),
    notes: text("notes"),
    /** Provenance. `linear_import` rows mirror Linear's `mgsolln`. */
    source: feeRunSourceEnum("source").notNull().default("app"),
    /**
     * Linear `mgsolln.GUID`. We aggregate multiple Linear rows (one per
     * `Zeitraum`) into a single Sollstellung; this stores the first row's
     * GUID and serves as the join key against `lastprots.SollGUID`.
     */
    linearGuid: text("linear_guid"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("soll_stellungen_contract_year_uk").on(t.contractId, t.billingYear),
    index("soll_stellungen_member_idx").on(t.memberId),
    index("soll_stellungen_status_idx").on(t.status),
    index("soll_stellungen_linear_guid_idx").on(t.linearGuid),
  ],
);

export type FeeRun = typeof feeRunsTable.$inferSelect;
export type NewFeeRun = typeof feeRunsTable.$inferInsert;
export type FeeRunItem = typeof feeRunItemsTable.$inferSelect;
export type NewFeeRunItem = typeof feeRunItemsTable.$inferInsert;
export type SollStellung = typeof sollStellungenTable.$inferSelect;
export type NewSollStellung = typeof sollStellungenTable.$inferInsert;
