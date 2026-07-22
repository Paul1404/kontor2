import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { auditLogTable } from "~/server/db/schema/audit";
import { users } from "~/server/db/schema/auth";
import { membersTable } from "~/server/db/schema/members";

export const snapshotTriggerEnum = pgEnum("snapshot_trigger", [
  "mutation",
  "nightly",
  "manual",
  "pre_restore",
  "pre_import",
]);

/**
 * Groups multiple member snapshots taken in one operation. A nightly cron
 * produces exactly one run with N snapshots; a bulk SQL import produces one
 * run with one snapshot per affected member. Mutation snapshots typically
 * are represented as one-member runs so the central history also shows them.
 */
export const snapshotRunsTable = pgTable(
  "snapshot_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trigger: snapshotTriggerEnum("trigger").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    memberCount: integer("member_count").notNull().default(0),
    bytesTotal: integer("bytes_total").notNull().default(0),
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorEmail: text("actor_email"),
    notes: text("notes"),
  },
  (t) => [
    index("snapshot_runs_trigger_idx").on(t.trigger, t.startedAt),
    index("snapshot_runs_started_idx").on(t.startedAt),
  ],
);

/**
 * One full point-in-time snapshot of a single member, including all
 * dependent rows (contracts, sepa, etc.) for that member at the moment of
 * capture. Stores plaintext IBAN in the JSONB blob because the column type
 * round-trips through `encryptedText` (decrypts on read, re-encrypts on
 * write) — storing ciphertext would be both redundant and would break
 * restores.
 */
export const memberSnapshotsTable = pgTable(
  "member_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").references(() => snapshotRunsTable.id, { onDelete: "set null" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => membersTable.id, { onDelete: "cascade" }),
    trigger: snapshotTriggerEnum("trigger").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorEmail: text("actor_email"),
    auditId: uuid("audit_id").references(() => auditLogTable.id, { onDelete: "set null" }),
    notes: text("notes"),

    member: jsonb("member").$type<Record<string, unknown>>().notNull(),
    contracts: jsonb("contracts")
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    sepa: jsonb("sepa").$type<Record<string, unknown>[]>().notNull().default(sql`'[]'::jsonb`),
    attachments: jsonb("attachments")
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    relationships: jsonb("relationships")
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    memberAbteilungen: jsonb("member_abteilungen")
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    sollstellungen: jsonb("sollstellungen")
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    families: jsonb("families")
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),

    contentHash: text("content_hash").notNull(),
    byteSize: integer("byte_size").notNull(),
  },
  (t) => [
    index("snapshots_member_created_idx").on(t.memberId, t.createdAt),
    index("snapshots_run_idx").on(t.runId),
    index("snapshots_member_hash_idx").on(t.memberId, t.contentHash),
  ],
);

export type SnapshotRun = typeof snapshotRunsTable.$inferSelect;
export type MemberSnapshot = typeof memberSnapshotsTable.$inferSelect;
