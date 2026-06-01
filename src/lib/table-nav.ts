/**
 * Cursor math for keyboard-navigable tables (Linear-style j/k movement).
 * Pure so the wrap/clamp behaviour is unit-testable without a DOM.
 */

/** Clamp an index into `[0, length-1]`, or -1 when there are no rows. */
export function clampCursor(index: number, length: number): number {
  if (length <= 0) return -1;
  if (index < 0) return 0;
  if (index > length - 1) return length - 1;
  return index;
}

/**
 * Move the cursor by `delta`. From "no cursor" (-1), a downward move lands on
 * the first row and an upward move on the last. Otherwise it clamps at the
 * ends (no wrap-around — wrapping past the bottom is more disorienting than
 * useful in a paginated list).
 */
export function moveCursor(current: number, delta: number, length: number): number {
  if (length <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : length - 1;
  return clampCursor(current + delta, length);
}
