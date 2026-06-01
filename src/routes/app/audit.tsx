import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Search, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { PageSizeSelect, usePersistentPageSize } from "~/components/ui/page-size-select";
import { QueryError } from "~/components/ui/query-error";
import { Skeleton } from "~/components/ui/skeleton";
import {
  actionLabel,
  entityLabel,
  fieldLabel,
  formatAuditValue,
  isHiddenField,
} from "~/lib/audit-labels";
import { formatDateTime } from "~/lib/format";
import { orpc } from "~/lib/orpc";

type Action = "create" | "update" | "delete" | "restore";

type AuditSearch = {
  q: string;
  actorEmail: string;
  action: Action | "";
  entityType: string;
  entityId: string;
  from: string;
  to: string;
};

const EMPTY_SEARCH: AuditSearch = {
  q: "",
  actorEmail: "",
  action: "",
  entityType: "",
  entityId: "",
  from: "",
  to: "",
};

export const Route = createFileRoute("/app/audit")({
  component: AuditPage,
  validateSearch: (s: Record<string, unknown>): AuditSearch => ({
    q: typeof s.q === "string" ? s.q : "",
    actorEmail: typeof s.actorEmail === "string" ? s.actorEmail : "",
    action: (typeof s.action === "string" ? s.action : "") as Action | "",
    entityType: typeof s.entityType === "string" ? s.entityType : "",
    entityId: typeof s.entityId === "string" ? s.entityId : "",
    from: typeof s.from === "string" ? s.from : "",
    to: typeof s.to === "string" ? s.to : "",
  }),
});

function AuditPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePersistentPageSize("audit.pageSize", 50);

  // The free-text box is bound to local state so typing doesn't fire a
  // request on every keystroke. We commit on Enter or blur. Discrete
  // filters commit immediately because there's no typing involved.
  const [qDraft, setQDraft] = useState(search.q);

  const actors = useQuery({
    queryKey: ["audit.actors"],
    queryFn: () => orpc.audit.actors(),
  });
  const entityTypes = useQuery({
    queryKey: ["audit.entityTypes"],
    queryFn: () => orpc.audit.entityTypes(),
  });

  const list = useQuery({
    queryKey: ["audit.list", { ...search, page, pageSize }],
    queryFn: () =>
      orpc.audit.list({
        page,
        pageSize,
        q: search.q,
        actorEmail: search.actorEmail || null,
        action: (search.action || null) as Action | null,
        entityType: search.entityType || null,
        entityId: search.entityId || null,
        from: search.from || null,
        to: search.to || null,
      }),
  });

  function updateSearch(patch: Partial<AuditSearch>) {
    setPage(1);
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  }

  const hasFilter =
    !!search.q ||
    !!search.actorEmail ||
    !!search.action ||
    !!search.entityType ||
    !!search.entityId ||
    !!search.from ||
    !!search.to;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
        <p className="text-sm text-muted-foreground">
          Wer hat wann was geändert. Filter und Suche sind kombinierbar.
        </p>
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Suche in Benutzer, Entität, geänderten Feldern oder Werten"
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
          <FilterSelect
            label="Aktion"
            value={search.action}
            onChange={(v) => updateSearch({ action: v as Action | "" })}
            options={[
              { value: "create", label: "Angelegt" },
              { value: "update", label: "Geändert" },
              { value: "delete", label: "Gelöscht" },
              { value: "restore", label: "Wiederhergestellt" },
            ]}
          />
          <FilterSelect
            label="Entität"
            value={search.entityType}
            onChange={(v) => updateSearch({ entityType: v })}
            options={(entityTypes.data ?? []).map((t) => ({
              value: t,
              label: entityLabel(t),
            }))}
          />
          <FilterSelect
            label="Benutzer"
            value={search.actorEmail}
            onChange={(v) => updateSearch({ actorEmail: v })}
            options={(actors.data ?? []).map((a) => ({ value: a, label: a }))}
          />
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Von</span>
            <Input
              type="date"
              value={search.from}
              onChange={(e) => updateSearch({ from: e.target.value })}
              className="h-9 w-40"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Bis</span>
            <Input
              type="date"
              value={search.to}
              onChange={(e) => updateSearch({ to: e.target.value })}
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
              }}
            >
              <X className="size-3.5" /> Filter zurücksetzen
            </Button>
          ) : null}
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <ul className="divide-y divide-border">
          {list.isLoading ? (
            Array.from({ length: Math.min(pageSize, 8) }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: pure visual placeholder
              <li key={i} className="flex items-start gap-3 px-4 py-3">
                <Skeleton className="h-5 w-20" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3 w-56" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-3 w-28" />
              </li>
            ))
          ) : list.isError ? (
            <li className="px-4 py-6">
              <QueryError error={list.error} onRetry={() => list.refetch()} />
            </li>
          ) : (list.data?.rows.length ?? 0) === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-muted-foreground">
              Keine Einträge passen zu diesen Filtern.
            </li>
          ) : (
            list.data?.rows.map((r) => <AuditRow key={r.id} row={r as never} />)
          )}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-4 py-3 text-sm">
          <span className="text-muted-foreground">{list.data?.total ?? 0} Einträge</span>
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
                disabled={(list.data?.rows.length ?? 0) < pageSize}
                onClick={() => setPage((p) => p + 1)}
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

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 min-w-32 rounded-md border border-input bg-card px-2 text-sm shadow-soft focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <option value="">Alle</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

type AuditRowData = {
  id: string;
  action: string;
  source: string;
  actorEmail: string | null;
  entityType: string;
  entityId: string;
  changes: Record<string, { before: unknown; after: unknown }> | null;
  createdAt: string | Date;
  target: {
    memberId: string;
    mitglnr: string | null;
    adrNr: number;
    vorname: string | null;
    nachname: string | null;
  } | null;
};

function AuditRow({ row }: { row: AuditRowData }) {
  const [open, setOpen] = useState(false);
  const visibleChanges = Object.entries(row.changes ?? {}).filter(([k]) => !isHiddenField(k));
  const summary = visibleChanges
    .slice(0, 4)
    .map(([k]) => fieldLabel(k))
    .join(", ");

  const targetName = row.target
    ? [row.target.vorname, row.target.nachname].filter(Boolean).join(" ") ||
      `#${row.target.mitglnr ?? ""}`
    : null;

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30"
      >
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline">{actionLabel(row.action)}</Badge>
            <span className="font-medium">{entityLabel(row.entityType)}</span>
            {row.target ? (
              <Link
                to="/app/mitglieder/$mitgliedsnummer"
                params={{
                  mitgliedsnummer: row.target.mitglnr ?? String(row.target.adrNr),
                }}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                {targetName}
                <span className="text-xs text-muted-foreground tabular-nums">
                  ({row.target.mitglnr ?? `AdrNr ${row.target.adrNr}`})
                </span>
                <ExternalLink className="size-3" />
              </Link>
            ) : (
              <span className="font-mono text-xs text-muted-foreground">
                {row.entityId.slice(0, 8)}
              </span>
            )}
            {row.source !== "ui" ? (
              <Badge variant="secondary" className="text-xs">
                {row.source}
              </Badge>
            ) : null}
          </div>
          <div className="text-xs text-muted-foreground">
            {visibleChanges.length === 0
              ? "Keine sichtbaren Felder geändert"
              : `${visibleChanges.length} Feld${visibleChanges.length === 1 ? "" : "er"}: ${summary}${visibleChanges.length > 4 ? "…" : ""}`}
          </div>
          {row.actorEmail ? (
            <div className="text-xs text-muted-foreground">von {row.actorEmail}</div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
            {formatDateTime(row.createdAt)}
          </span>
          <ChevronDown
            className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </div>
      </button>
      {open && visibleChanges.length > 0 ? (
        <div className="border-t border-border bg-muted/30 px-4 py-2">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 font-medium">Feld</th>
                <th className="px-2 py-1.5 font-medium">Vorher</th>
                <th className="px-2 py-1.5 font-medium">Nachher</th>
              </tr>
            </thead>
            <tbody>
              {visibleChanges.map(([k, change]) => (
                <tr key={k} className="border-t border-border/40">
                  <td className="px-2 py-1.5 font-medium">{fieldLabel(k)}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">
                    {formatAuditValue(k, change.before)}
                  </td>
                  <td className="px-2 py-1.5">{formatAuditValue(k, change.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </li>
  );
}
