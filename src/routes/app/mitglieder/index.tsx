import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bookmark,
  BookmarkPlus,
  ChevronLeft,
  ChevronRight,
  Download,
  Layers,
  Loader2,
  Plus,
  Search,
  ShieldBan,
  Trash2,
  UserCheck,
  UserMinus,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { InlineStatusEdit } from "~/components/forms/InlineStatusEdit";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Input } from "~/components/ui/input";
import { PageSizeSelect, usePersistentPageSize } from "~/components/ui/page-size-select";
import { SkeletonTableRows } from "~/components/ui/skeleton";
import { toast } from "~/components/ui/toaster";
import { ABTEILUNG_NONE_FILTER } from "~/lib/abteilung-filter";
import { triggerDownload } from "~/lib/download";
import { EMPTY_VALUE, formatDate } from "~/lib/format";
import { memberRef } from "~/lib/member-ref";
import { orpc } from "~/lib/orpc";
import {
  createView,
  loadSavedViews,
  persistSavedViews,
  type SavedView,
  type ViewSearch,
  viewSearchEquals,
} from "~/lib/saved-views";
import { headerCheckState, rangeIds } from "~/lib/selection";
import { moveCursor } from "~/lib/table-nav";
import { isTypingTarget, usePageShortcut } from "~/lib/use-global-shortcuts";

type Status = "aktiv" | "passiv" | "gekuendigt" | "ausgetreten" | "verstorben" | "alle";
type SortBy = "nachname" | "mitgliedsnummer" | "ort" | "email" | "eintritt";
type SortDir = "asc" | "desc";

type MemberRow = {
  id: string;
  adrNr: number;
  memberNo: string | null;
  kontaktNo: string | null;
  mitgliedsnummer: string | null;
  vorname: string | null;
  nachname: string | null;
  plz: string | null;
  ort: string | null;
  email: string | null;
  eintritt: string | Date | null;
  austritt: string | Date | null;
  verstorbenAm: string | Date | null;
  status: string | null;
  deletedAt: string | Date | null;
};

type MembersSearch = {
  q: string;
  status: Status;
  abteilungId: string | null;
  includeAusgetretene: boolean;
  orphanOnly: boolean;
  deletedOnly: boolean;
  page: number;
  sortBy: SortBy;
  sortDir: SortDir;
};

const STATUS_VALUES: Status[] = [
  "aktiv",
  "passiv",
  "gekuendigt",
  "ausgetreten",
  "verstorben",
  "alle",
];
const SORT_VALUES: SortBy[] = ["nachname", "mitgliedsnummer", "ort", "email", "eintritt"];

const EMPTY_SEARCH: MembersSearch = {
  q: "",
  status: "aktiv",
  abteilungId: null,
  includeAusgetretene: false,
  orphanOnly: false,
  deletedOnly: false,
  page: 1,
  sortBy: "nachname",
  sortDir: "asc",
};

export const Route = createFileRoute("/app/mitglieder/")({
  component: MembersListPage,
  // Filter / paging / sort all live in the URL so a view is bookmarkable
  // and survives reloads. `validateSearch` coerces arbitrary input to a
  // safe shape (the URL is user-controlled).
  validateSearch: (s: Record<string, unknown>): MembersSearch => {
    const status = STATUS_VALUES.includes(s.status as Status) ? (s.status as Status) : "aktiv";
    const sortBy = SORT_VALUES.includes(s.sortBy as SortBy) ? (s.sortBy as SortBy) : "nachname";
    const sortDir = s.sortDir === "desc" ? "desc" : "asc";
    const pageNum = Number(s.page);
    return {
      q: typeof s.q === "string" ? s.q : "",
      status,
      abteilungId: typeof s.abteilungId === "string" && s.abteilungId ? s.abteilungId : null,
      includeAusgetretene: s.includeAusgetretene === true || s.includeAusgetretene === "true",
      orphanOnly: s.orphanOnly === true || s.orphanOnly === "true",
      deletedOnly: s.deletedOnly === true || s.deletedOnly === "true",
      page: Number.isFinite(pageNum) && pageNum >= 1 ? Math.floor(pageNum) : 1,
      sortBy,
      sortDir,
    };
  },
});

function MembersListPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [pageSize, setPageSize] = usePersistentPageSize("members.pageSize", 50);
  // Free-text search is local-state so typing doesn't shove a URL update
  // on every keystroke; debounced into the URL below.
  const [qDraft, setQDraft] = useState(search.q);

  // Keep qDraft in sync if the URL changes externally (browser back, etc.).
  useEffect(() => {
    setQDraft(search.q);
  }, [search.q]);

  // Debounce the search input → URL.
  useEffect(() => {
    if (qDraft === search.q) return;
    const t = window.setTimeout(() => {
      navigate({
        search: (prev) => ({ ...prev, q: qDraft, page: 1 }),
        replace: true,
      });
    }, 250);
    return () => window.clearTimeout(t);
  }, [qDraft, search.q, navigate]);

  const abteilungen = useQuery({
    queryKey: ["abteilungen", "members"],
    queryFn: () => orpc.members.abteilungenList(),
  });

  const me = useQuery({ queryKey: ["me"], queryFn: () => orpc.auth.me() });
  const canEdit = me.data?.role === "vorstand" || me.data?.role === "admin";

  const stats = useQuery({ queryKey: ["members.stats"], queryFn: () => orpc.members.stats() });

  const list = useQuery({
    queryKey: ["members.list", { ...search, pageSize }],
    queryFn: () => orpc.members.list({ ...search, pageSize }),
  });

  function updateSearch(patch: Partial<MembersSearch>, resetPage = true) {
    navigate({
      search: (prev) => ({ ...prev, ...patch, ...(resetPage ? { page: 1 } : {}) }),
      replace: true,
    });
  }

  function toggleSort(col: SortBy) {
    if (search.sortBy === col) {
      updateSearch({ sortDir: search.sortDir === "asc" ? "desc" : "asc" }, false);
    } else {
      updateSearch({ sortBy: col, sortDir: "asc" }, false);
    }
  }

  usePageShortcut("n", canEdit ? () => navigate({ to: "/app/mitglieder/neu" }) : null);

  const rows = (list.data?.rows ?? []) as MemberRow[];
  const visibleIds = useMemo(() => rows.map((r) => r.id), [rows]);

  // Multi-select lives in page-local state (not the URL): it's a transient
  // working set, not something you'd bookmark. Selection is scoped to the
  // rows currently on screen and clears whenever the view changes.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const anchorRef = useRef<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkAbteilungId, setBulkAbteilungId] = useState("");
  const [bulkSperre, setBulkSperre] = useState("");
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    destructive: boolean;
    run: () => Promise<void>;
  } | null>(null);

  // Reset the selection whenever the underlying result set changes (filter,
  // sort, page, page size) so a stale id can never be acted on.
  const viewKey = JSON.stringify({ ...search, pageSize });
  // biome-ignore lint/correctness/useExhaustiveDependencies: viewKey is the trigger; we intentionally only reset state.
  useEffect(() => {
    setSelected(new Set());
    anchorRef.current = null;
    setCursor(-1);
  }, [viewKey]);

  const headerState = headerCheckState(visibleIds, selected);
  const selectedCount = selected.size;

  function toggleRow(id: string, shiftKey: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shiftKey && anchorRef.current) {
        // Shift-click selects the whole inclusive range between the last
        // clicked row and this one.
        for (const rid of rangeIds(visibleIds, anchorRef.current, id)) next.add(rid);
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    anchorRef.current = id;
  }

  function toggleAllOnPage() {
    setSelected((prev) => {
      const everySelected = visibleIds.length > 0 && visibleIds.every((id) => prev.has(id));
      if (everySelected) {
        const next = new Set(prev);
        for (const id of visibleIds) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of visibleIds) next.add(id);
      return next;
    });
    anchorRef.current = null;
  }

  function clearSelection() {
    setSelected(new Set());
    anchorRef.current = null;
  }

  // --- Keyboard-native row navigation (Linear-style j/k cursor) ----------
  const [cursor, setCursor] = useState(-1);
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const confirmOpenRef = useRef(false);
  confirmOpenRef.current = confirm !== null;
  const cursorRowRef = useRef<HTMLTableRowElement | null>(null);

  // Scroll the focused row into view as the cursor moves.
  useEffect(() => {
    if (cursor >= 0) cursorRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  // Bind once; read live values via refs and functional state updates so the
  // listener never goes stale and doesn't re-bind on every keystroke.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (confirmOpenRef.current) return;
      // Don't drive the table while any modal overlay is open (command
      // palette, cheatsheet, release notes, confirm dialogs). They all mark
      // themselves aria-modal; without this guard `j/k/o` would move the
      // cursor — or worse, navigate away — behind an open dialog.
      if (typeof document !== "undefined" && document.querySelector('[aria-modal="true"]')) return;
      const currentRows = rowsRef.current;
      const len = currentRows.length;
      const k = e.key;

      if (k === "j" || k === "k") {
        if (len === 0) return;
        e.preventDefault();
        const next = moveCursor(cursorRef.current, k === "j" ? 1 : -1, len);
        cursorRef.current = next;
        setCursor(next);
        // Shift extends the selection onto the row we just landed on.
        if (e.shiftKey && canEditRef.current && next >= 0) {
          const row = currentRows[next];
          if (row) {
            setSelected((prev) => new Set(prev).add(row.id));
            anchorRef.current = row.id;
          }
        }
        return;
      }

      if (k === "o" || k === "Enter") {
        const row = cursorRef.current >= 0 ? currentRows[cursorRef.current] : undefined;
        if (!row) return;
        e.preventDefault();
        navigate({
          to: "/app/mitglieder/$mitgliedsnummer",
          params: { mitgliedsnummer: memberRef(row) },
        });
        return;
      }

      if (k === "x" && canEditRef.current) {
        const row = cursorRef.current >= 0 ? currentRows[cursorRef.current] : undefined;
        if (!row) return;
        e.preventDefault();
        setSelected((prev) => {
          const nextSet = new Set(prev);
          if (nextSet.has(row.id)) nextSet.delete(row.id);
          else nextSet.add(row.id);
          return nextSet;
        });
        anchorRef.current = row.id;
        return;
      }

      if (k === "Escape") {
        setSelected((prev) => {
          if (prev.size === 0) return prev;
          anchorRef.current = null;
          return new Set();
        });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  // --- Saved Views (per-browser presets of the filter + sort state) ------
  const [views, setViews] = useState<SavedView[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  // Load after mount (localStorage isn't available during SSR; deferring also
  // avoids a hydration mismatch on the chip bar).
  useEffect(() => {
    setViews(loadSavedViews());
  }, []);

  const currentViewSearch: ViewSearch = (() => {
    const { page: _page, ...rest } = search;
    return rest;
  })();
  const activeViewId =
    views.find((view) => viewSearchEquals(view.search, currentViewSearch))?.id ?? null;

  function applyView(view: SavedView) {
    setQDraft(view.search.q);
    // Saved views predate the Papierkorb filter; default it off so applying a
    // view always lands on the live list.
    navigate({ search: () => ({ ...EMPTY_SEARCH, ...view.search, page: 1 }), replace: true });
  }

  function saveCurrentView() {
    const name = viewName.trim();
    if (!name) return;
    const next = [...views, createView(name, currentViewSearch)];
    setViews(next);
    persistSavedViews(next);
    setViewName("");
    setSaveOpen(false);
    toast.success(`Ansicht "${name}" gespeichert`);
  }

  function deleteView(id: string) {
    const next = views.filter((view) => view.id !== id);
    setViews(next);
    persistSavedViews(next);
  }

  async function runBulk(
    action:
      | { type: "setAktivPasiv"; value: "A" | "P" }
      | { type: "addAbteilung"; abteilungId: string }
      | { type: "removeAbteilung"; abteilungId: string }
      | { type: "setDunningBlocked"; value: boolean }
      | { type: "setDirectDebitBlocked"; value: boolean }
      | { type: "softDelete" },
    successVerb: string,
  ) {
    const ids = [...selected];
    setBulkBusy(true);
    try {
      const res = await orpc.members.bulk({ memberIds: ids, action });
      await Promise.all([list.refetch(), abteilungen.refetch(), stats.refetch()]);
      clearSelection();
      const skippedNote = res.skipped > 0 ? ` (${res.skipped} übersprungen)` : "";
      toast.success(`${res.changed} ${successVerb}${skippedNote}`);
    } catch (err) {
      toast.error("Aktion fehlgeschlagen", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBulkBusy(false);
      setConfirm(null);
    }
  }

  async function exportSelection() {
    try {
      const res = await orpc.reports.membersExport({ ids: [...selected] });
      triggerDownload(res.filename, res.content, "text/csv;charset=utf-8");
      toast.success(`${selectedCount} Mitglieder exportiert`);
    } catch (err) {
      toast.error("Export fehlgeschlagen", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const bulkAbteilungName = bulkAbteilungId
    ? abteilungen.data?.find((a) => a.id === bulkAbteilungId)?.name
    : null;

  const hasFilter =
    !!search.q ||
    search.status !== "aktiv" ||
    !!search.abteilungId ||
    search.includeAusgetretene ||
    search.orphanOnly ||
    search.deletedOnly;

  const abteilungName =
    search.abteilungId === ABTEILUNG_NONE_FILTER
      ? "Ohne Abteilung"
      : search.abteilungId
        ? abteilungen.data?.find((a) => a.id === search.abteilungId)?.name
        : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Mitglieder</h1>
          <p className="text-sm text-muted-foreground">
            <span className="hidden sm:inline">
              Suchen, filtern und Profile öffnen. Tipp:{" "}
              <kbd className="rounded border border-border bg-muted px-1 text-[10px]">j</kbd>/
              <kbd className="rounded border border-border bg-muted px-1 text-[10px]">k</kbd> zum
              Navigieren,{" "}
              <kbd className="rounded border border-border bg-muted px-1 text-[10px]">n</kbd> für
              neu, <kbd className="rounded border border-border bg-muted px-1 text-[10px]">?</kbd>{" "}
              für alle Kürzel.
            </span>
            <span className="sm:hidden">Suchen, filtern und Profile öffnen.</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              try {
                const res = await orpc.reports.membersExport({
                  q: search.q,
                  status: search.status,
                  abteilungId: search.abteilungId,
                  includeAusgetretene: search.includeAusgetretene,
                });
                triggerDownload(res.filename, res.content, "text/csv;charset=utf-8");
                toast.success("CSV heruntergeladen");
              } catch (err) {
                toast.error("Export fehlgeschlagen", {
                  description: err instanceof Error ? err.message : String(err),
                });
              }
            }}
          >
            <Download className="size-4" /> Als CSV
          </Button>
          {canEdit ? (
            <Link to="/app/mitglieder/neu">
              <Button>
                <Plus className="size-4" /> Neues Mitglied
              </Button>
            </Link>
          ) : null}
        </div>
      </div>

      <MemberStatsStrip
        stats={stats.data}
        loading={stats.isLoading}
        activeStatus={search.status}
        onPick={(status) => updateSearch({ status })}
      />

      {views.length > 0 || hasFilter ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Bookmark className="size-3.5" /> Ansichten
          </span>
          {views.map((view) => {
            const active = view.id === activeViewId;
            return (
              <span
                key={view.id}
                className={`group inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
                  active
                    ? "border-primary/40 bg-primary/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                <button type="button" onClick={() => applyView(view)} className="max-w-40 truncate">
                  {view.name}
                </button>
                <button
                  type="button"
                  onClick={() => deleteView(view.id)}
                  className="rounded-full p-0.5 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                  aria-label={`Ansicht "${view.name}" löschen`}
                >
                  <X className="size-3" />
                </button>
              </span>
            );
          })}
          {saveOpen ? (
            <span className="inline-flex items-center gap-1">
              <Input
                autoFocus
                className="h-8 w-44"
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                placeholder="Name der Ansicht"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    saveCurrentView();
                  } else if (e.key === "Escape") {
                    setSaveOpen(false);
                    setViewName("");
                  }
                }}
              />
              <Button type="button" size="sm" onClick={saveCurrentView} disabled={!viewName.trim()}>
                Speichern
              </Button>
              <button
                type="button"
                onClick={() => {
                  setSaveOpen(false);
                  setViewName("");
                }}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Abbrechen"
              >
                <X className="size-4" />
              </button>
            </span>
          ) : hasFilter && !activeViewId ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setSaveOpen(true)}>
              <BookmarkPlus className="size-4" /> Ansicht speichern
            </Button>
          ) : null}
        </div>
      ) : null}

      <Card>
        <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:flex-wrap sm:items-center sm:p-4">
          <div className="relative w-full sm:min-w-60 sm:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Name, Mitgliedsnummer, E-Mail, Ort"
              value={qDraft}
              onChange={(e) => setQDraft(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-3">
            <select
              value={search.status}
              onChange={(e) => updateSearch({ status: e.target.value as Status })}
              className="h-10 min-w-0 rounded-lg border border-input bg-card px-3 text-sm shadow-soft focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <option value="aktiv">Aktiv</option>
              <option value="passiv">Passiv</option>
              <option value="gekuendigt">Gekündigt</option>
              <option value="ausgetreten">Ausgetreten</option>
              <option value="verstorben">Verstorben</option>
              <option value="alle">Alle</option>
            </select>
            <select
              value={search.abteilungId ?? ""}
              onChange={(e) => updateSearch({ abteilungId: e.target.value || null })}
              className="h-10 min-w-0 rounded-lg border border-input bg-card px-3 text-sm shadow-soft focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <option value="">Alle Abteilungen</option>
              <option value={ABTEILUNG_NONE_FILTER}>Ohne Abteilung</option>
              {abteilungen.data?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.count})
                </option>
              ))}
            </select>
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-soft">
            <input
              type="checkbox"
              checked={search.includeAusgetretene}
              onChange={(e) => updateSearch({ includeAusgetretene: e.target.checked })}
              className="size-4 accent-primary"
            />
            <span className="text-muted-foreground">Ausgetretene anzeigen</span>
          </label>
          {me.data?.role === "admin" ? (
            <label
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-soft"
              title="Kontakte ohne Mitgliedsnummer und ohne jegliche Beziehung"
            >
              <input
                type="checkbox"
                checked={search.orphanOnly}
                onChange={(e) => updateSearch({ orphanOnly: e.target.checked })}
                className="size-4 accent-primary"
              />
              <span className="text-muted-foreground">Nur verwaiste Kontakte</span>
            </label>
          ) : null}
          {canEdit ? (
            <label
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-soft"
              title="Gelöschte Mitglieder anzeigen, um sie wiederherzustellen"
            >
              <input
                type="checkbox"
                checked={search.deletedOnly}
                onChange={(e) => updateSearch({ deletedOnly: e.target.checked })}
                className="size-4 accent-primary"
              />
              <span className="text-muted-foreground">Papierkorb</span>
            </label>
          ) : null}
        </CardContent>
      </Card>

      {hasFilter ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Aktive Filter:</span>
          {search.q ? (
            <FilterChip
              label={`Suche: "${search.q}"`}
              onRemove={() => {
                setQDraft("");
                updateSearch({ q: "" });
              }}
            />
          ) : null}
          {search.status !== "aktiv" ? (
            <FilterChip
              label={`Status: ${search.status}`}
              onRemove={() => updateSearch({ status: "aktiv" })}
            />
          ) : null}
          {abteilungName ? (
            <FilterChip
              label={`Abteilung: ${abteilungName}`}
              onRemove={() => updateSearch({ abteilungId: null })}
            />
          ) : null}
          {search.includeAusgetretene ? (
            <FilterChip
              label="inkl. Ausgetretene"
              onRemove={() => updateSearch({ includeAusgetretene: false })}
            />
          ) : null}
          {search.orphanOnly ? (
            <FilterChip
              label="Verwaiste Kontakte"
              onRemove={() => updateSearch({ orphanOnly: false })}
            />
          ) : null}
          {search.deletedOnly ? (
            <FilterChip label="Papierkorb" onRemove={() => updateSearch({ deletedOnly: false })} />
          ) : null}
          <button
            type="button"
            onClick={() => {
              setQDraft("");
              navigate({ search: () => EMPTY_SEARCH, replace: true });
            }}
            className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            alle zurücksetzen
          </button>
        </div>
      ) : null}

      {canEdit && selectedCount > 0 ? (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card/95 p-2.5 shadow-soft backdrop-blur">
          <span className="px-1 text-sm font-medium tabular-nums">{selectedCount} ausgewählt</span>
          <button
            type="button"
            onClick={clearSelection}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Auswahl aufheben"
            title="Auswahl aufheben"
          >
            <X className="size-4" />
          </button>
          <div className="mx-1 hidden h-5 w-px bg-border sm:block" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={bulkBusy}
            onClick={() =>
              setConfirm({
                title: "Als aktiv markieren",
                description: `${selectedCount} ausgewählte Mitglieder auf "Aktiv" setzen?`,
                destructive: false,
                run: () => runBulk({ type: "setAktivPasiv", value: "A" }, "auf Aktiv gesetzt"),
              })
            }
          >
            <UserCheck className="size-4" /> Aktiv
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={bulkBusy}
            onClick={() =>
              setConfirm({
                title: "Als passiv markieren",
                description: `${selectedCount} ausgewählte Mitglieder auf "Passiv" setzen?`,
                destructive: false,
                run: () => runBulk({ type: "setAktivPasiv", value: "P" }, "auf Passiv gesetzt"),
              })
            }
          >
            <UserMinus className="size-4" /> Passiv
          </Button>
          <div className="mx-1 hidden h-5 w-px bg-border sm:block" />
          <div className="flex items-center gap-1.5">
            <Layers className="size-4 text-muted-foreground" />
            <select
              value={bulkAbteilungId}
              onChange={(e) => setBulkAbteilungId(e.target.value)}
              className="h-9 min-w-0 max-w-44 rounded-lg border border-input bg-card px-2 text-sm shadow-soft focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              aria-label="Abteilung für Massenaktion"
            >
              <option value="">Abteilung wählen…</option>
              {abteilungen.data?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={bulkBusy || !bulkAbteilungId}
              onClick={() =>
                setConfirm({
                  title: "Zu Abteilung hinzufügen",
                  description: `${selectedCount} ausgewählte Mitglieder der Abteilung "${bulkAbteilungName}" zuordnen? Bereits zugeordnete werden übersprungen.`,
                  destructive: false,
                  run: () =>
                    runBulk(
                      { type: "addAbteilung", abteilungId: bulkAbteilungId },
                      `zu ${bulkAbteilungName} hinzugefügt`,
                    ),
                })
              }
            >
              Hinzufügen
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={bulkBusy || !bulkAbteilungId}
              onClick={() =>
                setConfirm({
                  title: "Aus Abteilung entfernen",
                  description: `Mitgliedschaft in "${bulkAbteilungName}" für ${selectedCount} ausgewählte Mitglieder beenden (Austrittsdatum heute)?`,
                  destructive: true,
                  run: () =>
                    runBulk(
                      { type: "removeAbteilung", abteilungId: bulkAbteilungId },
                      `aus ${bulkAbteilungName} entfernt`,
                    ),
                })
              }
            >
              Entfernen
            </Button>
          </div>
          <div className="mx-1 hidden h-5 w-px bg-border sm:block" />
          <div className="flex items-center gap-1.5">
            <ShieldBan className="size-4 text-muted-foreground" />
            <select
              value={bulkSperre}
              onChange={(e) => setBulkSperre(e.target.value)}
              className="h-9 min-w-0 max-w-48 rounded-lg border border-input bg-card px-2 text-sm shadow-soft focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              aria-label="Sperre für Massenaktion"
            >
              <option value="">Sperre wählen…</option>
              <option value="mahn-on">Mahnsperre setzen</option>
              <option value="mahn-off">Mahnsperre aufheben</option>
              <option value="einzug-on">Einzug aussetzen</option>
              <option value="einzug-off">Einzug freigeben</option>
            </select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={bulkBusy || !bulkSperre}
              onClick={() => {
                const map: Record<
                  string,
                  {
                    action: Parameters<typeof runBulk>[0];
                    title: string;
                    verb: string;
                  }
                > = {
                  "mahn-on": {
                    action: { type: "setDunningBlocked", value: true },
                    title: "Mahnsperre setzen",
                    verb: "mit Mahnsperre versehen",
                  },
                  "mahn-off": {
                    action: { type: "setDunningBlocked", value: false },
                    title: "Mahnsperre aufheben",
                    verb: "Mahnsperre aufgehoben",
                  },
                  "einzug-on": {
                    action: { type: "setDirectDebitBlocked", value: true },
                    title: "Einzug aussetzen",
                    verb: "Einzug ausgesetzt",
                  },
                  "einzug-off": {
                    action: { type: "setDirectDebitBlocked", value: false },
                    title: "Einzug freigeben",
                    verb: "Einzug freigegeben",
                  },
                };
                const choice = map[bulkSperre];
                if (!choice) return;
                setConfirm({
                  title: choice.title,
                  description: `${choice.title} für ${selectedCount} ausgewählte Mitglieder? Bereits passende werden übersprungen.`,
                  destructive: false,
                  run: () => runBulk(choice.action, choice.verb),
                });
              }}
            >
              Anwenden
            </Button>
          </div>
          <div className="mx-1 hidden h-5 w-px bg-border sm:block" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={bulkBusy}
            onClick={() =>
              setConfirm({
                title: "In den Papierkorb verschieben",
                description: `${selectedCount} ausgewählte Mitglieder in den Papierkorb verschieben? Lässt sich über die Papierkorb-Ansicht wiederherstellen.`,
                destructive: true,
                run: () => runBulk({ type: "softDelete" }, "in den Papierkorb verschoben"),
              })
            }
          >
            <Trash2 className="size-4" /> Papierkorb
          </Button>
          <div className="mx-1 hidden h-5 w-px bg-border sm:block" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={bulkBusy}
            onClick={exportSelection}
          >
            <Download className="size-4" /> Auswahl als CSV
          </Button>
          {bulkBusy ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
          ) : null}
        </div>
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                {canEdit ? (
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="Alle auf dieser Seite auswählen"
                      className="size-4 accent-primary align-middle"
                      checked={headerState === "all"}
                      ref={(el) => {
                        if (el) el.indeterminate = headerState === "some";
                      }}
                      onChange={toggleAllOnPage}
                    />
                  </th>
                ) : null}
                <SortHeader
                  label="Mitgl.-Nr."
                  col="mitgliedsnummer"
                  active={search.sortBy}
                  dir={search.sortDir}
                  onToggle={toggleSort}
                />
                <SortHeader
                  label="Name"
                  col="nachname"
                  active={search.sortBy}
                  dir={search.sortDir}
                  onToggle={toggleSort}
                />
                <SortHeader
                  label="Ort"
                  col="ort"
                  active={search.sortBy}
                  dir={search.sortDir}
                  onToggle={toggleSort}
                />
                <SortHeader
                  label="E-Mail"
                  col="email"
                  active={search.sortBy}
                  dir={search.sortDir}
                  onToggle={toggleSort}
                />
                <SortHeader
                  label="Eintritt"
                  col="eintritt"
                  active={search.sortBy}
                  dir={search.sortDir}
                  onToggle={toggleSort}
                />
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.isLoading ? (
                <SkeletonTableRows rows={Math.min(pageSize, 10)} cols={canEdit ? 7 : 6} />
              ) : list.isError ? (
                <tr>
                  <td colSpan={canEdit ? 7 : 6} className="px-4 py-10 text-center">
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <AlertTriangle className="size-6 text-warning" />
                      <p className="text-sm">Mitglieder konnten nicht geladen werden.</p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => list.refetch()}
                      >
                        Erneut versuchen
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={canEdit ? 7 : 6}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    Keine Mitglieder gefunden.
                  </td>
                </tr>
              ) : (
                rows.map((m, index) => {
                  const isKontakt = !m.mitgliedsnummer;
                  const isSelected = selected.has(m.id);
                  const isCursor = index === cursor;
                  return (
                    <tr
                      key={m.id}
                      ref={isCursor ? cursorRowRef : undefined}
                      className={`transition-colors ${
                        isCursor ? "bg-primary/10 ring-2 ring-inset ring-primary/40" : ""
                      } ${isSelected && !isCursor ? "bg-primary/5" : ""} ${
                        !isSelected && !isCursor ? "hover:bg-muted/30" : ""
                      }`}
                    >
                      {canEdit ? (
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            aria-label={`${[m.nachname, m.vorname].filter(Boolean).join(", ")} auswählen`}
                            className="size-4 accent-primary align-middle"
                            checked={isSelected}
                            onClick={(e) => toggleRow(m.id, e.shiftKey)}
                            onChange={() => {
                              /* handled in onClick to read shiftKey */
                            }}
                          />
                        </td>
                      ) : null}
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">
                        {m.memberNo ?? (
                          <span
                            className="text-muted-foreground/60"
                            title="Kein Mitglied, nur Zahler/Kontakt"
                          >
                            {m.kontaktNo}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            to="/app/mitglieder/$mitgliedsnummer"
                            params={{ mitgliedsnummer: memberRef(m) }}
                            className="font-medium text-primary hover:underline"
                          >
                            {[m.nachname, m.vorname].filter(Boolean).join(", ")}
                          </Link>
                          {isKontakt ? (
                            <Badge
                              variant="outline"
                              title="Zahlt für ein Mitglied, ist aber selbst keines"
                            >
                              Kontakt
                            </Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3">{[m.plz, m.ort].filter(Boolean).join(" ")}</td>
                      <td className="px-4 py-3 text-muted-foreground">{m.email || EMPTY_VALUE}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(m.eintritt)}</td>
                      <td className="px-4 py-3">
                        <InlineStatusEdit
                          member={m}
                          canEdit={canEdit}
                          abteilungen={abteilungen.data ?? []}
                          onChanged={() => {
                            list.refetch();
                            stats.refetch();
                            abteilungen.refetch();
                          }}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-4 py-3 text-sm">
          <span className="text-muted-foreground">{list.data?.total ?? 0} Einträge</span>
          <div className="flex items-center gap-4">
            <PageSizeSelect
              value={pageSize}
              onChange={(n) => {
                setPageSize(n);
                updateSearch({});
              }}
            />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={search.page <= 1}
                onClick={() => updateSearch({ page: Math.max(1, search.page - 1) }, false)}
              >
                <ChevronLeft className="size-3.5" /> Zurück
              </Button>
              <span className="text-muted-foreground">Seite {search.page}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={search.page * pageSize >= (list.data?.total ?? 0)}
                onClick={() => updateSearch({ page: search.page + 1 }, false)}
              >
                Weiter <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open && !bulkBusy) setConfirm(null);
        }}
        title={confirm?.title ?? ""}
        description={confirm?.description}
        confirmLabel="Anwenden"
        destructive={confirm?.destructive ?? false}
        loading={bulkBusy}
        onConfirm={() => {
          if (confirm) void confirm.run();
        }}
      />
    </div>
  );
}

type MemberStats = {
  total: number;
  aktiv: number;
  passiv: number;
  gekuendigt: number;
  ausgetreten: number;
  verstorben: number;
  kontakte: number;
};

function MemberStatsStrip({
  stats,
  loading,
  activeStatus,
  onPick,
}: {
  stats: MemberStats | undefined;
  loading: boolean;
  activeStatus: Status;
  onPick: (status: Status) => void;
}) {
  const tiles: { key: Status; label: string; value: number; dot: string }[] = [
    { key: "alle", label: "Gesamt", value: stats?.total ?? 0, dot: "bg-muted-foreground/40" },
    { key: "aktiv", label: "Aktiv", value: stats?.aktiv ?? 0, dot: "bg-success" },
    { key: "passiv", label: "Passiv", value: stats?.passiv ?? 0, dot: "bg-muted-foreground/60" },
    // Only surface "Gekündigt" when there are pending exits (or the filter is
    // active), so the strip stays calm when nobody is leaving.
    ...(stats?.gekuendigt || activeStatus === "gekuendigt"
      ? [
          {
            key: "gekuendigt" as Status,
            label: "Gekündigt",
            value: stats?.gekuendigt ?? 0,
            dot: "bg-amber-400",
          },
        ]
      : []),
    {
      key: "ausgetreten",
      label: "Ausgetreten",
      value: stats?.ausgetreten ?? 0,
      dot: "bg-warning",
    },
    {
      key: "verstorben",
      label: "Verstorben",
      value: stats?.verstorben ?? 0,
      dot: "bg-muted-foreground/60",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((t) => {
        const active = activeStatus === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onPick(t.key)}
            aria-pressed={active}
            className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors ${
              active
                ? "border-primary/40 bg-primary/5"
                : "border-border bg-card hover:border-ring/40 hover:bg-muted/30"
            }`}
          >
            <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <span className={`size-2 rounded-full ${t.dot}`} aria-hidden />
              {t.label}
            </span>
            {loading ? (
              <span className="h-7 w-12 animate-pulse rounded bg-muted" />
            ) : (
              <span className="text-2xl font-semibold tabular-nums leading-none">{t.value}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function SortHeader({
  label,
  col,
  active,
  dir,
  onToggle,
}: {
  label: string;
  col: SortBy;
  active: SortBy;
  dir: SortDir;
  onToggle: (col: SortBy) => void;
}) {
  const isActive = active === col;
  const Icon = !isActive ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className="px-4 py-3 font-medium">
      <button
        type="button"
        onClick={() => onToggle(col)}
        className="-mx-1 flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted hover:text-foreground"
      >
        {label}
        <Icon className={`size-3 ${isActive ? "text-foreground" : "text-muted-foreground/60"}`} />
      </button>
    </th>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-foreground">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label={`Filter "${label}" entfernen`}
      >
        <X className="size-3" />
      </button>
    </span>
  );
}
