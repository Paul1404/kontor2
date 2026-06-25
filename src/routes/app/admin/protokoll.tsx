import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Info,
  ListFilter,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { DateField } from "~/components/ui/date-field";
import { Input } from "~/components/ui/input";
import { PageSizeSelect, usePersistentPageSize } from "~/components/ui/page-size-select";
import { QueryError } from "~/components/ui/query-error";
import { Skeleton } from "~/components/ui/skeleton";
import { toast } from "~/components/ui/toaster";
import { cn } from "~/lib/cn";
import { EMPTY_VALUE, formatDateTime, orEmpty } from "~/lib/format";
import { orpc } from "~/lib/orpc";

type Level = "info" | "warn" | "error";

type LogSearch = {
  q: string;
  level: Level | "";
  requestId: string;
  proc: string;
  from: string;
  to: string;
};

const EMPTY_SEARCH: LogSearch = {
  q: "",
  level: "",
  requestId: "",
  proc: "",
  from: "",
  to: "",
};

const LEVEL_META: Record<
  Level,
  { label: string; bar: string; badge: string; icon: typeof Info; accent: string }
> = {
  info: {
    label: "Info",
    bar: "bg-sky-400/70",
    badge: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    icon: Info,
    accent: "text-sky-600 dark:text-sky-400",
  },
  warn: {
    label: "Warnung",
    bar: "bg-amber-400/80",
    badge: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    icon: AlertTriangle,
    accent: "text-amber-600 dark:text-amber-400",
  },
  error: {
    label: "Fehler",
    bar: "bg-red-500/80",
    badge: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
    icon: AlertCircle,
    accent: "text-red-600 dark:text-red-400",
  },
};

export const Route = createFileRoute("/app/admin/protokoll")({
  beforeLoad: async () => {
    let me: Awaited<ReturnType<typeof orpc.auth.me>>;
    try {
      me = await orpc.auth.me();
    } catch {
      throw redirect({ to: "/login" });
    }
    if (me.role !== "admin") throw redirect({ to: "/app" });
  },
  component: ProtokollPage,
  validateSearch: (s: Record<string, unknown>): LogSearch => ({
    q: typeof s.q === "string" ? s.q : "",
    level: (typeof s.level === "string" ? s.level : "") as Level | "",
    requestId: typeof s.requestId === "string" ? s.requestId : "",
    proc: typeof s.proc === "string" ? s.proc : "",
    from: typeof s.from === "string" ? s.from : "",
    to: typeof s.to === "string" ? s.to : "",
  }),
});

function ProtokollPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePersistentPageSize("logs.pageSize", 50);
  const [qDraft, setQDraft] = useState(search.q);
  const [live, setLive] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);

  // Keep the search box in sync if the URL changes from elsewhere (e.g. the
  // clear button or a request-id chip), without clobbering active typing.
  useEffect(() => {
    setQDraft(search.q);
  }, [search.q]);

  const range = { from: search.from || null, to: search.to || null };
  const refetchInterval = live ? 5_000 : false;

  const config = useQuery({
    queryKey: ["logs.config"],
    queryFn: () => orpc.logs.config(),
    staleTime: 5 * 60_000,
  });

  const stats = useQuery({
    queryKey: ["logs.stats", range],
    queryFn: () => orpc.logs.stats(range),
    refetchInterval,
  });

  const list = useQuery({
    queryKey: ["logs.list", { ...search, page, pageSize }],
    queryFn: () =>
      orpc.logs.list({
        page,
        pageSize,
        q: search.q,
        level: (search.level || null) as Level | null,
        requestId: search.requestId || null,
        proc: search.proc || null,
        from: search.from || null,
        to: search.to || null,
      }),
    refetchInterval,
  });

  const purge = useMutation({
    mutationFn: (olderThanDays: number | null) => orpc.logs.purge({ olderThanDays }),
    onSuccess: (res) => {
      toast.success(`${res.deleted} Einträge gelöscht.`);
      setPurgeOpen(false);
      queryClient.invalidateQueries({ queryKey: ["logs.list"] });
      queryClient.invalidateQueries({ queryKey: ["logs.stats"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Löschen fehlgeschlagen."),
  });

  function updateSearch(patch: Partial<LogSearch>) {
    setPage(1);
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  }

  function refreshNow() {
    queryClient.invalidateQueries({ queryKey: ["logs.list"] });
    queryClient.invalidateQueries({ queryKey: ["logs.stats"] });
  }

  const hasFilter =
    !!search.q ||
    !!search.level ||
    !!search.requestId ||
    !!search.proc ||
    !!search.from ||
    !!search.to;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Systemprotokoll</h1>
          <p className="text-sm text-muted-foreground">
            Strukturierte Anwendungslogs aus dem laufenden Betrieb. Gespiegelt aus der Konsole,
            damit Ereignisse und Fehler ohne Serverzugriff sichtbar sind.
          </p>
          {config.data ? (
            <p className="text-xs text-muted-foreground">
              {config.data.enabled
                ? `Aufzeichnung ab Stufe ${LEVEL_META[config.data.level].label}, Aufbewahrung ${config.data.retentionDays} Tage, maximal ${config.data.maxRows.toLocaleString("de-DE")} Einträge.`
                : "Die Aufzeichnung in die Datenbank ist deaktiviert (LOG_DB_DISABLED=1). Es werden keine neuen Einträge gespeichert."}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant={live ? "default" : "outline"}
            size="sm"
            onClick={() => setLive((v) => !v)}
            aria-pressed={live}
          >
            <span
              className={cn(
                "size-2 rounded-full",
                live ? "animate-pulse bg-white" : "bg-muted-foreground/50",
              )}
              aria-hidden
            />
            Live
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={refreshNow}
            disabled={list.isFetching}
            aria-label="Aktualisieren"
          >
            <RefreshCw className={cn("size-3.5", list.isFetching && "animate-spin")} />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPurgeOpen(true)}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="size-3.5" /> Leeren
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Gesamt"
          value={stats.data?.total ?? 0}
          loading={stats.isLoading}
          active={search.level === ""}
          onClick={() => updateSearch({ level: "" })}
        />
        <StatCard
          label="Info"
          value={stats.data?.info ?? 0}
          loading={stats.isLoading}
          level="info"
          active={search.level === "info"}
          onClick={() => updateSearch({ level: search.level === "info" ? "" : "info" })}
        />
        <StatCard
          label="Warnungen"
          value={stats.data?.warn ?? 0}
          loading={stats.isLoading}
          level="warn"
          active={search.level === "warn"}
          onClick={() => updateSearch({ level: search.level === "warn" ? "" : "warn" })}
        />
        <StatCard
          label="Fehler"
          value={stats.data?.error ?? 0}
          loading={stats.isLoading}
          level="error"
          active={search.level === "error"}
          onClick={() => updateSearch({ level: search.level === "error" ? "" : "error" })}
        />
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Suche in Meldung, Prozedur, Request-ID oder Feldern"
              value={qDraft}
              onChange={(e) => setQDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") updateSearch({ q: qDraft });
              }}
              onBlur={() => {
                if (qDraft !== search.q) updateSearch({ q: qDraft });
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Stufe</span>
            <select
              value={search.level}
              onChange={(e) => updateSearch({ level: e.target.value as Level | "" })}
              className="h-9 min-w-32 rounded-md border border-input bg-card px-2 text-sm shadow-soft focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <option value="">Alle</option>
              <option value="info">Info</option>
              <option value="warn">Warnung</option>
              <option value="error">Fehler</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Von</span>
            <DateField
              value={search.from}
              onChange={(v) => updateSearch({ from: v })}
              className="h-9 w-40"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Bis</span>
            <DateField
              value={search.to}
              onChange={(v) => updateSearch({ to: v })}
              className="h-9 w-40"
            />
          </div>
          {hasFilter ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setQDraft("");
                navigate({ search: () => EMPTY_SEARCH, replace: true });
                setPage(1);
              }}
            >
              <X className="size-3.5" /> Filter zurücksetzen
            </Button>
          ) : null}
        </div>
        {search.requestId || search.proc ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
            <ListFilter className="size-3.5" />
            <span>Eingegrenzt auf:</span>
            {search.requestId ? (
              <FilterChip
                label={`Request ${search.requestId.slice(0, 8)}`}
                onClear={() => updateSearch({ requestId: "" })}
              />
            ) : null}
            {search.proc ? (
              <FilterChip label={search.proc} onClear={() => updateSearch({ proc: "" })} />
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card className="overflow-hidden p-0">
        <ul className="divide-y divide-border">
          {list.isLoading ? (
            Array.from({ length: Math.min(pageSize, 8) }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: pure visual placeholder
              <li key={i} className="flex items-start gap-3 px-4 py-3">
                <Skeleton className="h-5 w-16" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3 w-72" />
                  <Skeleton className="h-3 w-40" />
                </div>
                <Skeleton className="h-3 w-28" />
              </li>
            ))
          ) : list.isError ? (
            <li className="px-4 py-6">
              <QueryError error={list.error} onRetry={() => list.refetch()} />
            </li>
          ) : (list.data?.rows.length ?? 0) === 0 ? (
            <li className="px-4 py-10 text-center text-sm text-muted-foreground">
              Keine Einträge passen zu diesen Filtern.
            </li>
          ) : (
            list.data?.rows.map((r) => (
              <LogRow
                key={r.id}
                row={r as LogRowData}
                onFilterRequest={(id) => updateSearch({ requestId: id })}
                onFilterProc={(p) => updateSearch({ proc: p })}
              />
            ))
          )}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-4 py-3 text-sm">
          <span className="text-muted-foreground">
            {(list.data?.total ?? 0).toLocaleString("de-DE")} Einträge
            {stats.data?.lastEventAt ? (
              <span className="ml-2">· zuletzt {formatDateTime(stats.data.lastEventAt)}</span>
            ) : null}
          </span>
          <div className="flex items-center gap-4">
            <PageSizeSelect
              value={pageSize}
              onChange={(n) => {
                setPageSize(n);
                setPage(1);
              }}
            />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="size-3.5" /> Zurück
              </Button>
              <span className="text-muted-foreground">Seite {page}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page * pageSize >= (list.data?.total ?? 0)}
                onClick={() => setPage((p) => p + 1)}
              >
                Weiter <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={purgeOpen}
        onOpenChange={setPurgeOpen}
        title="Protokoll leeren"
        description="Lösche Einträge dauerhaft aus der Datenbank. Die laufende Aufzeichnung bleibt aktiv. Älter als 7 Tage entfernt nur ältere Einträge, Alles löschen leert das gesamte Protokoll."
        destructive
        confirmLabel="Alles löschen"
        cancelLabel="Abbrechen"
        loading={purge.isPending}
        onConfirm={() => purge.mutate(null)}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          disabled={purge.isPending}
          onClick={() => purge.mutate(7)}
        >
          Nur Einträge älter als 7 Tage löschen
        </Button>
      </ConfirmDialog>
    </div>
  );
}

function StatCard({
  label,
  value,
  loading,
  level,
  active,
  onClick,
}: {
  label: string;
  value: number;
  loading: boolean;
  level?: Level;
  active: boolean;
  onClick: () => void;
}) {
  const meta = level ? LEVEL_META[level] : null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col gap-1 rounded-xl border bg-card p-4 text-left transition-colors",
        active ? "border-ring ring-2 ring-ring/20" : "border-border hover:border-ring/40",
      )}
    >
      <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {meta ? <meta.icon className={cn("size-3.5", meta.accent)} /> : null}
        {label}
      </span>
      {loading ? (
        <Skeleton className="h-7 w-14" />
      ) : (
        <span
          className={cn(
            "text-2xl font-semibold tabular-nums",
            meta && value > 0 ? meta.accent : "text-foreground",
          )}
        >
          {value.toLocaleString("de-DE")}
        </span>
      )}
    </button>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 py-0.5 pl-2 pr-1 font-mono text-[11px] text-foreground">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label="Filter entfernen"
        className="inline-flex size-4 items-center justify-center rounded-full hover:bg-muted"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

type LogRowData = {
  id: string;
  level: Level;
  message: string;
  requestId: string | null;
  proc: string | null;
  actorEmail: string | null;
  fields: Record<string, unknown> | null;
  pid: number | null;
  hostname: string | null;
  createdAt: string | Date;
};

function LogRow({
  row,
  onFilterRequest,
  onFilterProc,
}: {
  row: LogRowData;
  onFilterRequest: (requestId: string) => void;
  onFilterProc: (proc: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const meta = LEVEL_META[row.level];
  const fields = row.fields ?? {};
  const hasFields = Object.keys(fields).length > 0;
  const hasDetail = hasFields || row.pid != null || row.hostname != null;

  return (
    <li className="relative">
      <span className={cn("absolute inset-y-0 left-0 w-[3px]", meta.bar)} aria-hidden />
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        className={cn(
          "flex w-full items-start justify-between gap-3 px-4 py-3 pl-5 text-left transition-colors",
          hasDetail ? "hover:bg-muted/30" : "cursor-default",
        )}
      >
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline" className={cn("font-medium", meta.badge)}>
              {meta.label}
            </Badge>
            <span className="break-all font-medium">{row.message}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {row.proc ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (row.proc) onFilterProc(row.proc);
                }}
                className="font-mono text-primary hover:underline"
              >
                {row.proc}
              </button>
            ) : null}
            {row.requestId ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (row.requestId) onFilterRequest(row.requestId);
                }}
                className="inline-flex items-center gap-1 font-mono hover:text-foreground"
                title={`Alle Einträge dieser Anfrage: ${row.requestId}`}
              >
                req {row.requestId.slice(0, 8)}
              </button>
            ) : null}
            {row.actorEmail ? <span>{row.actorEmail}</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
            {formatDateTime(row.createdAt)}
          </span>
          {hasDetail ? (
            <ChevronDown
              className={cn(
                "size-4 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
            />
          ) : (
            <span className="size-4" aria-hidden />
          )}
        </div>
      </button>
      {open && hasDetail ? (
        <div className="border-t border-border bg-muted/30 px-5 py-3">
          <dl className="mb-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Zeitpunkt</dt>
            <dd className="tabular-nums">{formatDateTime(row.createdAt)}</dd>
            <dt className="text-muted-foreground">Request-ID</dt>
            <dd className="break-all font-mono">{orEmpty(row.requestId)}</dd>
            <dt className="text-muted-foreground">Prozess</dt>
            <dd className="font-mono">
              {row.hostname ? `${row.hostname}` : EMPTY_VALUE}
              {row.pid != null ? ` · pid ${row.pid}` : ""}
            </dd>
          </dl>
          {hasFields ? (
            <pre className="overflow-x-auto rounded-md bg-background/60 p-3 text-xs leading-relaxed scrollbar-thin">
              {JSON.stringify(fields, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
