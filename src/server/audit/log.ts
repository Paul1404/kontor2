import type { DB } from "~/server/db/client";
import { auditLogTable } from "~/server/db/schema/audit";
import { lastFour } from "~/server/crypto/encrypt";

/**
 * Columns whose plaintext values should NEVER appear in the audit log.
 * We diff their `lastFour()` projection instead.
 */
const SECRET_COLUMNS = new Set(["iban1", "iban2", "iban3", "passwordEncrypted"]);

export type Changes = Record<string, { before: unknown; after: unknown }>;

/**
 * Shallow diff: only emit fields whose value changed between `before` and
 * `after`. `null` and `undefined` are treated as equal. Date instances are
 * compared by ISO string. Secret columns are masked.
 */
export function diff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): Changes {
  const out: Changes = {};
  const keys = new Set([...(before ? Object.keys(before) : []), ...Object.keys(after)]);
  for (const k of keys) {
    const a = (after as Record<string, unknown>)[k];
    const b = before ? (before as Record<string, unknown>)[k] : undefined;
    if (eq(a, b)) continue;
    if (SECRET_COLUMNS.has(k)) {
      out[k] = {
        before: typeof b === "string" ? lastFour(b) : b == null ? null : "***",
        after: typeof a === "string" ? lastFour(a) : a == null ? null : "***",
      };
    } else {
      out[k] = { before: b ?? null, after: a ?? null };
    }
  }
  return out;
}

function eq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof Date && typeof b === "string") return a.toISOString() === b;
  if (b instanceof Date && typeof a === "string") return b.toISOString() === a;
  return false;
}

export type LogEntry = {
  entityType: string;
  entityId: string;
  action: "create" | "update" | "delete" | "restore";
  source: "ui" | "import" | "svums_push" | "system";
  actorId?: string | null;
  actorEmail?: string | null;
  changes: Changes;
  requestId?: string | null;
};

export async function appendAudit(db: DB, entry: LogEntry): Promise<void> {
  if (Object.keys(entry.changes).length === 0 && entry.action === "update") return;
  await db.insert(auditLogTable).values({
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    source: entry.source,
    actorId: entry.actorId ?? null,
    actorEmail: entry.actorEmail ?? null,
    changes: entry.changes,
    requestId: entry.requestId ?? null,
  });
}
