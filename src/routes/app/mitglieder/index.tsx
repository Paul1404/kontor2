import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { PageSizeSelect, usePersistentPageSize } from "~/components/ui/page-size-select";
import { SkeletonTableRows } from "~/components/ui/skeleton";
import { toast } from "~/components/ui/toaster";
import { triggerDownload } from "~/lib/download";
import { formatDate } from "~/lib/format";
import { orpc } from "~/lib/orpc";
import { usePageShortcut } from "~/lib/use-global-shortcuts";

type Status = "aktiv" | "passiv" | "ausgetreten" | "verstorben" | "alle";
type SortBy = "nachname" | "mitglnr" | "ort" | "email" | "eintritt";
type SortDir = "asc" | "desc";

type MemberRow = {
  id: string;
  adrNr: number;
  mitglnr: string | null;
  vorname: string | null;
  nachname: string | null;
  plz: string | null;
  ort: string | null;
  email: string | null;
  eintritt: string | Date | null;
  austritt: string | Date | null;
  verstorbenAm: string | Date | null;
  aktivPasiv: string | null;
};

type MembersSearch = {
  q: string;
  status: Status;
  abteilungId: string | null;
  includeAusgetretene: boolean;
  page: number;
  sortBy: SortBy;
  sortDir: SortDir;
};

const STATUS_VALUES: Status[] = ["aktiv", "passiv", "ausgetreten", "verstorben", "alle"];
const SORT_VALUES: SortBy[] = ["nachname", "mitglnr", "ort", "email", "eintritt"];

const EMPTY_SEARCH: MembersSearch = {
  q: "",
  status: "aktiv",
  abteilungId: null,
  includeAusgetretene: false,
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

  const hasFilter =
    !!search.q || search.status !== "aktiv" || !!search.abteilungId || search.includeAusgetretene;

  const abteilungName = search.abteilungId
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
              <kbd className="rounded border border-border bg-muted px-1 text-[10px]">n</kbd> für
              neu, <kbd className="rounded border border-border bg-muted px-1 text-[10px]">⌘K</kbd>{" "}
              für Suche.
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

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <SortHeader
                  label="Mitgl.-Nr."
                  col="mitglnr"
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
                <SkeletonTableRows rows={Math.min(pageSize, 10)} cols={6} />
              ) : list.data?.rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    Keine Mitglieder gefunden.
                  </td>
                </tr>
              ) : (
                (list.data?.rows ?? []).map((row) => {
                  const m = row as MemberRow;
                  return (
                    <tr key={m.id} className="transition-colors hover:bg-muted/30">
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">
                        {m.mitglnr ?? "-"}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          to="/app/mitglieder/$mitgliedsnummer"
                          params={{ mitgliedsnummer: m.mitglnr ?? String(m.adrNr) }}
                          className="font-medium text-primary hover:underline"
                        >
                          {[m.nachname, m.vorname].filter(Boolean).join(", ")}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{[m.plz, m.ort].filter(Boolean).join(" ")}</td>
                      <td className="px-4 py-3 text-muted-foreground">{m.email ?? ""}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(m.eintritt)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge member={m} />
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
                disabled={(list.data?.rows.length ?? 0) < pageSize}
                onClick={() => updateSearch({ page: search.page + 1 }, false)}
              >
                Weiter <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </Card>
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

function StatusBadge({ member }: { member: MemberRow }) {
  if (member.verstorbenAm) return <Badge variant="secondary">Verstorben</Badge>;
  if (member.austritt) return <Badge variant="warning">Ausgetreten</Badge>;
  if (member.aktivPasiv === "P") return <Badge variant="secondary">Passiv</Badge>;
  return <Badge variant="success">Aktiv</Badge>;
}
