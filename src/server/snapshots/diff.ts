import { type Changes, diff as fieldDiff } from "~/server/audit/log";

export type SnapshotDiff = {
  member: Changes;
  contracts: { added: number; removed: number; changedIds: string[] };
  sepa: { added: number; removed: number; changedIds: string[] };
  attachments: { added: number; removed: number };
  relationships: { added: number; removed: number; changedIds: string[] };
  memberAbteilungen: { added: number; removed: number };
  sollstellungen: { added: number; removed: number; changedIds: string[] };
  families: { added: number; removed: number; changedIds: string[] };
};

function compareList(
  before: Record<string, unknown>[],
  after: Record<string, unknown>[],
  key: string | ((row: Record<string, unknown>) => string) = "id",
): { added: number; removed: number; changedIds: string[] } {
  const keyOf =
    typeof key === "function" ? key : (row: Record<string, unknown>) => String(row[key]);
  const beforeMap = new Map<string, Record<string, unknown>>();
  for (const row of before) beforeMap.set(keyOf(row), row);
  const afterMap = new Map<string, Record<string, unknown>>();
  for (const row of after) afterMap.set(keyOf(row), row);

  let added = 0;
  let removed = 0;
  const changedIds: string[] = [];

  for (const [id, row] of afterMap) {
    const prior = beforeMap.get(id);
    if (!prior) {
      added += 1;
      continue;
    }
    const changes = fieldDiff(prior, row);
    if (Object.keys(changes).length > 0) changedIds.push(id);
  }
  for (const id of beforeMap.keys()) {
    if (!afterMap.has(id)) removed += 1;
  }
  return { added, removed, changedIds };
}

/**
 * Compare the current (live) member state to a stored snapshot. Used to
 * preview what a restore would change before the user commits to it.
 *
 * `before` is the snapshot blob (what we'd restore to), `after` is the
 * current live state — so `Changes` rows read as "snapshot value → live
 * value", and a restore swaps them.
 */
export function diffSnapshotVsCurrent(
  snapshot: {
    member: Record<string, unknown>;
    contracts: Record<string, unknown>[];
    sepa: Record<string, unknown>[];
    attachments: Record<string, unknown>[];
    relationships: Record<string, unknown>[];
    memberAbteilungen: Record<string, unknown>[];
    sollstellungen: Record<string, unknown>[];
    families: Record<string, unknown>[];
  },
  current: {
    member: Record<string, unknown>;
    contracts: Record<string, unknown>[];
    sepa: Record<string, unknown>[];
    attachments: Record<string, unknown>[];
    relationships: Record<string, unknown>[];
    memberAbteilungen: Record<string, unknown>[];
    sollstellungen: Record<string, unknown>[];
    families: Record<string, unknown>[];
  },
): SnapshotDiff {
  return {
    member: fieldDiff(snapshot.member, current.member),
    contracts: compareList(snapshot.contracts, current.contracts),
    sepa: compareList(snapshot.sepa, current.sepa),
    attachments: compareList(snapshot.attachments, current.attachments),
    relationships: compareList(snapshot.relationships, current.relationships),
    // member_abteilungen has no surrogate id; its identity is the composite
    // PK (member, abteilung, entry date). Keying on memberId alone would
    // collapse every department membership of a member into one and badly
    // under-report add/remove in the restore preview.
    memberAbteilungen: compareList(
      snapshot.memberAbteilungen,
      current.memberAbteilungen,
      (r) => `${r.memberId}|${r.abteilungId}|${r.eintrittsdatum}`,
    ),
    sollstellungen: compareList(snapshot.sollstellungen, current.sollstellungen),
    families: compareList(snapshot.families, current.families),
  };
}
