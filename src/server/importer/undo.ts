/** IDs written by a batch that did not exist in its complete pre-import run. */
export function importCreatedMemberIds(importedIds: string[], preImportIds: string[]): string[] {
  const existedBefore = new Set(preImportIds);
  return importedIds.filter((id) => !existedBefore.has(id));
}

/** Collect every address number referenced by rows an import may mutate. */
export function importTouchedAdrNrs(rows: Array<Record<string, unknown>>): number[] {
  const result = new Set<number>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      const normalized = key.replaceAll("_", "").toLowerCase();
      if (normalized !== "adrnr" && normalized !== "abwadrnr" && normalized !== "verkn") continue;
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed > 0) result.add(parsed);
    }
  }
  return [...result];
}
