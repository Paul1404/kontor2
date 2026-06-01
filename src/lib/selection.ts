/**
 * Selection helpers for table rows. Kept pure (no React) so the range/toggle
 * logic behind the members table's multi-select is unit-testable.
 */

/**
 * Inclusive list of ids between `anchorId` and `targetId` in the given row
 * order, regardless of which came first. Used for shift-click range select.
 * If either id isn't in `orderedIds`, falls back to just the target so a
 * stale anchor can never select a bogus range.
 */
export function rangeIds(
  orderedIds: readonly string[],
  anchorId: string,
  targetId: string,
): string[] {
  const a = orderedIds.indexOf(anchorId);
  const b = orderedIds.indexOf(targetId);
  if (a === -1 || b === -1) return orderedIds.includes(targetId) ? [targetId] : [];
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return orderedIds.slice(lo, hi + 1);
}

/** Tri-state for a "select all" header checkbox over the visible rows. */
export type HeaderCheckState = "none" | "some" | "all";

export function headerCheckState(
  visibleIds: readonly string[],
  selected: ReadonlySet<string>,
): HeaderCheckState {
  if (visibleIds.length === 0) return "none";
  let count = 0;
  for (const id of visibleIds) if (selected.has(id)) count += 1;
  if (count === 0) return "none";
  if (count === visibleIds.length) return "all";
  return "some";
}
