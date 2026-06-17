import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  CheckCircle2,
  Database,
  GitCompareArrows,
  KeyRound,
  Link2,
  Loader2,
  Search,
  Table2,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { InfoBox } from "~/components/ui/info-box";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Tabs } from "~/components/ui/tabs";
import { Textarea } from "~/components/ui/textarea";
import { EMPTY_VALUE, formatBytes, formatDateTime } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/archive")({
  component: ArchivePage,
});

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const result = fr.result as string;
      const idx = result.indexOf(",");
      resolve(idx === -1 ? result : result.slice(idx + 1));
    };
    fr.onerror = () => reject(fr.error ?? new Error("read failed"));
    fr.readAsDataURL(file);
  });
}

/** Render an archived JSONB cell value for a dense table. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return EMPTY_VALUE;
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

type TabKey = "overview" | "table" | "search" | "relationships";

function ArchivePage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>("overview");
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);

  const versionsQuery = useQuery({
    queryKey: ["archive.listVersions"],
    queryFn: () => orpc.archive.listVersions(),
  });

  // Default the selector to the latest version once the list loads.
  const effectiveVersion = selectedVersion ?? versionsQuery.data?.latestVersion ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">SQL-Archiv</h1>
        <p className="text-sm text-muted-foreground">
          Linear-Webverein-Dumps versioniert ablegen, durchsuchen und analysieren. Getrennt von den
          Live-Daten. Es findet kein Import statt.
        </p>
      </div>

      <InfoBox title="Wozu das Archiv" collapsible defaultOpen={false}>
        <p>
          Dieselbe <span className="font-mono">.sql</span>-Datei, die du sonst importierst, wird
          hier komplett und unverändert eingelesen, in eine eigene, durchsuchbare Ablage. Jeder
          Upload wird zu einer neuen Version, die höchste Nummer ist die aktuelle. So lässt sich die
          alte Datenbank durchsuchen und das Schema nachvollziehen, ohne die Mitgliederdaten dieser
          Anwendung zu berühren.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Die Analyse ist auch über die KI-Schnittstelle (MCP) verfügbar. Der Upload bleibt dem
          Adminbereich vorbehalten.
        </p>
      </InfoBox>

      <UploadCard
        onDone={() => {
          queryClient.invalidateQueries({ queryKey: ["archive.listVersions"] });
          setSelectedVersion(null);
        }}
      />

      <VersionsCard
        data={versionsQuery.data}
        loading={versionsQuery.isLoading}
        selected={effectiveVersion}
        onSelect={(vn) => {
          setSelectedVersion(vn);
          setSelectedTable(null);
        }}
        onDeleted={() => {
          queryClient.invalidateQueries({ queryKey: ["archive.listVersions"] });
          setSelectedVersion(null);
        }}
      />

      {effectiveVersion == null ? null : (
        <Card>
          <CardHeader>
            <CardTitle>Version {effectiveVersion}</CardTitle>
            <CardDescription>Tabellen, Spalten und Inhalte dieser Version.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Tabs
              value={tab}
              onValueChange={(v) => setTab(v as TabKey)}
              items={[
                { value: "overview", label: "Tabellen", icon: Table2 },
                { value: "table", label: "Tabelle", icon: Database },
                { value: "search", label: "Suche", icon: Search },
                { value: "relationships", label: "Beziehungen", icon: Link2 },
              ]}
            />
            {tab === "overview" ? (
              <OverviewTab
                version={effectiveVersion}
                onOpenTable={(t) => {
                  setSelectedTable(t);
                  setTab("table");
                }}
              />
            ) : null}
            {tab === "table" ? (
              <TableTab
                version={effectiveVersion}
                tableName={selectedTable}
                onPickTable={setSelectedTable}
              />
            ) : null}
            {tab === "search" ? <SearchTab version={effectiveVersion} /> : null}
            {tab === "relationships" ? <RelationshipsTab version={effectiveVersion} /> : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function UploadCard({ onDone }: { onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [token, setToken] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: async (progressToken: string) => {
      if (!file) throw new Error("Keine Datei ausgewählt.");
      const contentBase64 = await fileToBase64(file);
      return orpc.archive.upload({
        filename: file.name,
        contentBase64,
        notes: notes.trim() || null,
        progressToken,
      });
    },
    onSuccess: () => onDone(),
  });

  const progress = useQuery({
    queryKey: ["archive.progress", token],
    queryFn: () => orpc.archive.progress({ token: token as string }),
    enabled: !!token && upload.isPending,
    refetchInterval: 400,
    gcTime: 0,
  });

  const start = () => {
    const t = crypto.randomUUID();
    setToken(t);
    upload.mutate(t);
  };

  const prog = upload.isPending ? progress.data : undefined;
  const percent = prog && prog.total > 0 ? prog.percent : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Neue Version hochladen</CardTitle>
        <CardDescription>
          Die Datei wird vollständig eingelesen und als neue Version abgelegt.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <label className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/30 px-6 py-10 text-center transition-colors hover:bg-muted/50">
          <Upload className="size-6 text-muted-foreground" />
          <span className="text-sm">
            <span className="font-medium text-foreground">Klicken zum Auswählen</span>
            <span className="text-muted-foreground"> oder Datei hier ablegen</span>
          </span>
          <span className="text-xs text-muted-foreground">.sql · max. 50 MB</span>
          <input
            type="file"
            accept=".sql,text/plain"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="hidden"
          />
        </label>
        {file ? (
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-2 text-sm">
            <span className="font-medium">{file.name}</span>
            <span className="text-muted-foreground tabular-nums">{formatBytes(file.size)}</span>
          </div>
        ) : null}
        <Label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Notiz (optional)</span>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="z. B. Stand vom Jahreswechsel"
            rows={2}
          />
        </Label>
        <div className="flex items-center gap-3">
          <Button onClick={start} disabled={!file || upload.isPending}>
            {upload.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            {upload.isPending ? "Wird verarbeitet…" : "Version anlegen"}
          </Button>
        </div>

        {upload.isPending ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{prog?.phase || "Vorbereiten"}</span>
              <span className="tabular-nums text-muted-foreground">
                {percent === null ? "" : `${percent}%`}
                {prog && prog.total > 0 ? (
                  <span className="ml-2">
                    {prog.processed.toLocaleString("de-DE")} / {prog.total.toLocaleString("de-DE")}
                  </span>
                ) : null}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full bg-primary transition-all duration-300 ${
                  percent === null ? "animate-pulse w-1/3" : ""
                }`}
                style={percent === null ? undefined : { width: `${percent}%` }}
              />
            </div>
          </div>
        ) : null}

        {upload.isError ? (
          <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
            <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <span>Fehler: {(upload.error as Error).message}</span>
          </div>
        ) : null}

        {upload.data ? (
          <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/10 p-4 text-sm">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">Version {upload.data.version} angelegt.</span>
              <span className="text-muted-foreground">
                {upload.data.tableCount.toLocaleString("de-DE")} Tabellen,{" "}
                {upload.data.rowCount.toLocaleString("de-DE")} Zeilen.
                {upload.data.duplicateOfVersion != null
                  ? ` Inhaltlich identisch mit Version ${upload.data.duplicateOfVersion}.`
                  : ""}
              </span>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

type VersionsData = Awaited<ReturnType<typeof orpc.archive.listVersions>>;

function VersionsCard({
  data,
  loading,
  selected,
  onSelect,
  onDeleted,
}: {
  data: VersionsData | undefined;
  loading: boolean;
  selected: number | null;
  onSelect: (version: number) => void;
  onDeleted: () => void;
}) {
  const [toDelete, setToDelete] = useState<{ id: string; version: number } | null>(null);
  const del = useMutation({
    mutationFn: (versionId: string) => orpc.archive.deleteVersion({ versionId }),
    onSuccess: () => {
      setToDelete(null);
      onDeleted();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Versionen</CardTitle>
        <CardDescription>Jeder Upload ist eine Version. Die höchste ist aktuell.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Wird geladen…</p>
        ) : !data || data.versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Version vorhanden.</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {data.versions.map((v) => {
              const active = v.version === selected;
              return (
                <div
                  key={v.id}
                  className={`flex flex-wrap items-center gap-3 py-2.5 ${active ? "bg-muted/40" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(v.version)}
                    className="flex flex-1 items-center gap-3 text-left"
                  >
                    <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted font-semibold tabular-nums">
                      {v.version}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="flex items-center gap-2 font-medium">
                        <span className="truncate">{v.filename}</span>
                        {v.isLatest ? <Badge variant="success">aktuell</Badge> : null}
                        {v.status !== "ready" ? (
                          <Badge variant={v.status === "failed" ? "destructive" : "warning"}>
                            {v.status}
                          </Badge>
                        ) : null}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {v.tableCount.toLocaleString("de-DE")} Tabellen ·{" "}
                        {v.rowCount.toLocaleString("de-DE")} Zeilen · {formatBytes(v.fileSizeBytes)}{" "}
                        · {formatDateTime(v.createdAt)}
                        {v.createdByEmail ? ` · ${v.createdByEmail}` : ""}
                        {v.errorCount > 0 ? ` · ${v.errorCount} Hinweise` : ""}
                      </span>
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Version ${v.version} löschen`}
                    onClick={() => setToDelete({ id: v.id, version: v.version })}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Version ${toDelete?.version} löschen?`}
        description="Die Version und alle ihre archivierten Tabellen und Zeilen werden dauerhaft entfernt. Live-Daten sind nicht betroffen."
        destructive
        confirmLabel="Löschen"
        loading={del.isPending}
        onConfirm={() => toDelete && del.mutate(toDelete.id)}
      />
    </Card>
  );
}

function OverviewTab({
  version,
  onOpenTable,
}: {
  version: number;
  onOpenTable: (tableName: string) => void;
}) {
  const q = useQuery({
    queryKey: ["archive.overview", version],
    queryFn: () => orpc.archive.overview({ version }),
  });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Wird geladen…</p>;
  if (!q.data) return <p className="text-sm text-muted-foreground">Keine Daten.</p>;
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {q.data.tables.map((t) => (
        <button
          key={t.tableName}
          type="button"
          onClick={() => onOpenTable(t.tableName)}
          className="flex flex-col gap-1 rounded-lg border border-border bg-card/50 p-3 text-left transition-colors hover:bg-muted/50"
        >
          <span className="flex items-center gap-2 font-mono text-sm font-medium">
            <Table2 className="size-4 text-muted-foreground" />
            {t.tableName}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {t.rowCount.toLocaleString("de-DE")} Zeilen · {t.columnCount} Spalten
            {t.primaryKey.length > 0 ? ` · PK: ${t.primaryKey.join(", ")}` : ""}
          </span>
        </button>
      ))}
    </div>
  );
}

function TableTab({
  version,
  tableName,
  onPickTable,
}: {
  version: number;
  tableName: string | null;
  onPickTable: (tableName: string) => void;
}) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [submittedQ, setSubmittedQ] = useState("");

  const overview = useQuery({
    queryKey: ["archive.overview", version],
    queryFn: () => orpc.archive.overview({ version }),
  });

  const describe = useQuery({
    queryKey: ["archive.describeTable", version, tableName],
    queryFn: () => orpc.archive.describeTable({ version, tableName: tableName as string }),
    enabled: !!tableName,
  });

  const rows = useQuery({
    queryKey: ["archive.tableRows", version, tableName, submittedQ, page],
    queryFn: () =>
      orpc.archive.tableRows({
        version,
        tableName: tableName as string,
        q: submittedQ || null,
        page,
        pageSize: 25,
      }),
    enabled: !!tableName,
  });

  if (!tableName) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">Tabelle auswählen:</p>
        <div className="flex flex-wrap gap-2">
          {overview.data?.tables.map((t) => (
            <Button
              key={t.tableName}
              size="sm"
              variant="outline"
              onClick={() => onPickTable(t.tableName)}
            >
              <Table2 className="size-4" />
              {t.tableName}
            </Button>
          ))}
        </div>
      </div>
    );
  }

  const columnOrder = describe.data?.columns.map((c) => c.name) ?? [];
  const totalPages = rows.data ? Math.max(1, Math.ceil(rows.data.total / rows.data.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-medium">{tableName}</span>
        {overview.data ? (
          <div className="flex flex-wrap gap-1">
            {overview.data.tables.map((t) => (
              <Button
                key={t.tableName}
                size="sm"
                variant={t.tableName === tableName ? "default" : "ghost"}
                onClick={() => {
                  onPickTable(t.tableName);
                  setPage(1);
                  setQ("");
                  setSubmittedQ("");
                }}
              >
                {t.tableName}
              </Button>
            ))}
          </div>
        ) : null}
      </div>

      {describe.data ? (
        <details className="rounded-lg border border-border bg-muted/20 p-3" open>
          <summary className="cursor-pointer text-sm font-medium">
            Schema ({describe.data.columns.length} Spalten)
          </summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="px-2 py-1 font-medium">Spalte</th>
                  <th className="px-2 py-1 font-medium">Typ</th>
                  <th className="px-2 py-1 font-medium">Null?</th>
                  <th className="px-2 py-1 font-medium">Schlüssel</th>
                  <th className="px-2 py-1 font-medium tabular-nums">Leer</th>
                  <th className="px-2 py-1 font-medium tabular-nums">Distinct</th>
                  <th className="px-2 py-1 font-medium">Beispiele</th>
                </tr>
              </thead>
              <tbody>
                {describe.data.columns.map((c) => (
                  <tr key={c.name} className="border-t border-border/60">
                    <td className="px-2 py-1 font-mono font-medium">{c.name}</td>
                    <td className="px-2 py-1 font-mono text-muted-foreground">
                      {c.dataType ?? EMPTY_VALUE}
                    </td>
                    <td className="px-2 py-1">{c.nullable ? "ja" : "nein"}</td>
                    <td className="px-2 py-1">
                      {c.isPrimaryKey ? (
                        <Badge variant="info" className="gap-1">
                          <KeyRound className="size-3" />
                          PK
                        </Badge>
                      ) : c.isIndexed ? (
                        <Badge variant="outline">idx</Badge>
                      ) : (
                        EMPTY_VALUE
                      )}
                    </td>
                    <td className="px-2 py-1 tabular-nums text-muted-foreground">{c.nullCount}</td>
                    <td className="px-2 py-1 tabular-nums text-muted-foreground">
                      {c.distinctCount}
                      {c.distinctCapped ? "+" : ""}
                    </td>
                    <td className="px-2 py-1 text-muted-foreground">
                      {c.sampleValues.length > 0
                        ? c.sampleValues
                            .map((s) => cellText(s))
                            .slice(0, 4)
                            .join(", ")
                        : EMPTY_VALUE}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setSubmittedQ(q.trim());
        }}
      >
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="In dieser Tabelle suchen…"
        />
        <Button type="submit" variant="outline">
          <Search className="size-4" />
          Suchen
        </Button>
      </form>

      {rows.isLoading ? (
        <p className="text-sm text-muted-foreground">Wird geladen…</p>
      ) : rows.data && rows.data.rows.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-muted/40 text-left">
                  {columnOrder.map((col) => (
                    <th key={col} className="whitespace-nowrap px-2 py-1.5 font-mono font-medium">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.data.rows.map((r) => (
                  <tr key={r.rowIndex} className="border-t border-border/60 hover:bg-muted/30">
                    {columnOrder.map((col) => (
                      <td
                        key={col}
                        className="max-w-[20rem] truncate whitespace-nowrap px-2 py-1"
                        title={cellText((r.data as Record<string, unknown>)[col])}
                      >
                        {cellText((r.data as Record<string, unknown>)[col])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span className="tabular-nums">{rows.data.total.toLocaleString("de-DE")} Zeilen</span>
            <span className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Zurück
              </Button>
              <span className="tabular-nums">
                {page} / {totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Weiter
              </Button>
            </span>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Keine Zeilen.</p>
      )}
    </div>
  );
}

function SearchTab({ version }: { version: number }) {
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");
  const search = useQuery({
    queryKey: ["archive.search", version, submitted],
    queryFn: () => orpc.archive.search({ version, q: submitted, limit: 100 }),
    enabled: submitted.length > 0,
  });
  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(q.trim());
        }}
      >
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Über alle Tabellen dieser Version suchen…"
        />
        <Button type="submit" variant="outline">
          <Search className="size-4" />
          Suchen
        </Button>
      </form>
      {submitted.length === 0 ? (
        <p className="text-sm text-muted-foreground">Suchbegriff eingeben.</p>
      ) : search.isLoading ? (
        <p className="text-sm text-muted-foreground">Wird gesucht…</p>
      ) : search.data && search.data.rows.length > 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground tabular-nums">
            {search.data.total.toLocaleString("de-DE")} Treffer
            {search.data.total > search.data.rows.length
              ? ` (erste ${search.data.rows.length} angezeigt)`
              : ""}
          </p>
          {search.data.rows.map((r) => (
            <div
              key={`${r.tableName}:${r.rowIndex}`}
              className="rounded-lg border border-border bg-card/50 p-3"
            >
              <div className="mb-1 flex items-center gap-2">
                <Badge variant="outline" className="font-mono">
                  {r.tableName}
                </Badge>
                <span className="text-xs text-muted-foreground tabular-nums">#{r.rowIndex}</span>
              </div>
              <div className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(r.data as Record<string, unknown>)
                  .filter(([, val]) => val !== null && val !== undefined && String(val) !== "")
                  .slice(0, 12)
                  .map(([k, val]) => (
                    <div key={k} className="truncate" title={`${k}: ${cellText(val)}`}>
                      <span className="font-mono text-muted-foreground">{k}:</span>{" "}
                      <span>{cellText(val)}</span>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Keine Treffer.</p>
      )}
    </div>
  );
}

function RelationshipsTab({ version }: { version: number }) {
  const rel = useQuery({
    queryKey: ["archive.relationships", version],
    queryFn: () => orpc.archive.relationships({ version }),
  });
  const shared = useMemo(() => rel.data?.sharedColumns ?? [], [rel.data]);
  if (rel.isLoading) return <p className="text-sm text-muted-foreground">Wird geladen…</p>;
  if (!rel.data) return <p className="text-sm text-muted-foreground">Keine Daten.</p>;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <GitCompareArrows className="size-4" />
          Gemeinsame Spalten ({shared.length})
        </h3>
        <p className="text-xs text-muted-foreground">
          Spaltennamen, die in mehreren Tabellen vorkommen, sind die wahrscheinlichen Verknüpfungen.
        </p>
        <div className="flex flex-col divide-y divide-border">
          {shared.map((c) => (
            <div key={c.name} className="flex flex-wrap items-center gap-2 py-2">
              <span className="font-mono text-sm font-medium">{c.name}</span>
              <span className="text-xs text-muted-foreground">in {c.tableCount} Tabellen:</span>
              <div className="flex flex-wrap gap-1">
                {c.tables.map((t) => (
                  <Badge
                    key={`${c.name}:${t.tableName}`}
                    variant={t.isPrimaryKey ? "info" : "outline"}
                    className="gap-1 font-mono"
                  >
                    {t.isPrimaryKey ? <KeyRound className="size-3" /> : null}
                    {t.tableName}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <KeyRound className="size-4" />
          Primärschlüssel
        </h3>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {rel.data.primaryKeys.map((t) => (
            <div key={t.tableName} className="text-xs">
              <span className="font-mono font-medium">{t.tableName}</span>{" "}
              <span className="text-muted-foreground">→ {t.primaryKey.join(", ")}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
