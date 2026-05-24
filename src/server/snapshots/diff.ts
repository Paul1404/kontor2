import { type Changes, diff as fieldDiff } from "~/server/audit/log";

export type SnapshotDiff = {
  member: Changes;
  contracts: { added: number; removed: number; changedIds: string[] };
  sepa: { added: number; removed: number; changedIds: string[] };
  attachments: { added: number; removed: number };
  relationships: { added: number; removed: number; changedIds: string[] };
  memberAbteilungen: { added: number; removed: number };
  sollstellungen: { added: number; removed: number; changedIds: string[] };
};

function compareList(
  before: Record<string, unknown>[],
  after: Record<string, unknown>[],
  key: string = "id",
): { added: number; removed: number; changedIds: string[] } {
  const beforeMap = new Map<string, Record<string, unknown>>();
  for (const row of before) beforeMap.set(String(row[key]), row);
  const afterMap = new Map<string, Record<string, unknown>>();
  for (const row of after) afterMap.set(String(row[key]), row);

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
  },
  current: {
    member: Record<string, unknown>;
    contracts: Record<string, unknown>[];
    sepa: Record<string, unknown>[];
    attachments: Record<string, unknown>[];
    relationships: Record<string, unknown>[];
    memberAbteilungen: Record<string, unknown>[];
    sollstellungen: Record<string, unknown>[];
  },
): SnapshotDiff {
  return {
    member: fieldDiff(snapshot.member, current.member),
    contracts: compareList(snapshot.contracts, current.contracts),
    sepa: compareList(snapshot.sepa, current.sepa),
    attachments: compareList(snapshot.attachments, current.attachments),
    relationships: compareList(snapshot.relationships, current.relationships),
    memberAbteilungen: compareList(
      snapshot.memberAbteilungen,
      current.memberAbteilungen,
      "memberId",
    ),
    sollstellungen: compareList(snapshot.sollstellungen, current.sollstellungen),
  };
}
