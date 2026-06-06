/**
 * Saved Views for the members list: named presets of the filter + sort state,
 * persisted per-browser in localStorage. The Linear-style "switch between
 * saved filters in one click" feature.
 *
 * The persistence layer is intentionally thin; all the logic that decides
 * what a valid stored view looks like lives in pure functions below so it can
 * be unit-tested and so a corrupted localStorage value can never crash the
 * page (a bad entry is dropped, not thrown).
 */

export type ViewStatus = "aktiv" | "passiv" | "ausgetreten" | "verstorben" | "alle";
export type ViewSortBy = "nachname" | "mitgliedsnummer" | "ort" | "email" | "eintritt";
export type ViewSortDir = "asc" | "desc";

/** The bookmarkable filter/sort state of the members list, minus the page. */
export type ViewSearch = {
  q: string;
  status: ViewStatus;
  abteilungId: string | null;
  includeAusgetretene: boolean;
  orphanOnly: boolean;
  sortBy: ViewSortBy;
  sortDir: ViewSortDir;
};

export type SavedView = {
  id: string;
  name: string;
  search: ViewSearch;
};

const STATUS_VALUES: ViewStatus[] = ["aktiv", "passiv", "ausgetreten", "verstorben", "alle"];
const SORT_VALUES: ViewSortBy[] = ["nachname", "mitgliedsnummer", "ort", "email", "eintritt"];

export const SAVED_VIEWS_KEY = "members.savedViews.v1";

function coerceSearch(raw: unknown): ViewSearch {
  const s = (raw ?? {}) as Record<string, unknown>;
  const status = STATUS_VALUES.includes(s.status as ViewStatus)
    ? (s.status as ViewStatus)
    : "aktiv";
  const sortBy = SORT_VALUES.includes(s.sortBy as ViewSortBy)
    ? (s.sortBy as ViewSortBy)
    : "nachname";
  return {
    q: typeof s.q === "string" ? s.q : "",
    status,
    abteilungId: typeof s.abteilungId === "string" && s.abteilungId ? s.abteilungId : null,
    includeAusgetretene: s.includeAusgetretene === true,
    orphanOnly: s.orphanOnly === true,
    sortBy,
    sortDir: s.sortDir === "desc" ? "desc" : "asc",
  };
}

/**
 * Parse the raw localStorage string into a clean list of views. Anything that
 * isn't a well-formed array of `{ id, name, search }` is dropped silently —
 * the worst case is the user loses a malformed view, never a crash.
 */
export function parseStoredViews(raw: string | null | undefined): SavedView[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: SavedView[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const id = typeof e.id === "string" ? e.id : null;
    const name = typeof e.name === "string" ? e.name.trim() : "";
    if (!id || !name) continue;
    out.push({ id, name, search: coerceSearch(e.search) });
  }
  return out;
}

export function serializeViews(views: readonly SavedView[]): string {
  return JSON.stringify(views);
}

/** Structural equality of two view searches (used to highlight the active view). */
export function viewSearchEquals(a: ViewSearch, b: ViewSearch): boolean {
  return (
    a.q === b.q &&
    a.status === b.status &&
    a.abteilungId === b.abteilungId &&
    a.includeAusgetretene === b.includeAusgetretene &&
    a.orphanOnly === b.orphanOnly &&
    a.sortBy === b.sortBy &&
    a.sortDir === b.sortDir
  );
}

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createView(name: string, search: ViewSearch): SavedView {
  return { id: randomId(), name: name.trim(), search: coerceSearch(search) };
}

export function loadSavedViews(): SavedView[] {
  if (typeof window === "undefined") return [];
  try {
    return parseStoredViews(window.localStorage.getItem(SAVED_VIEWS_KEY));
  } catch {
    return [];
  }
}

export function persistSavedViews(views: readonly SavedView[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SAVED_VIEWS_KEY, serializeViews(views));
  } catch {
    // localStorage may be unavailable (private mode, quota). Saving a view
    // is a convenience, not load-bearing — swallow and move on.
  }
}
