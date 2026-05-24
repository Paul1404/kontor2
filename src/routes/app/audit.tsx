import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import {
  actionLabel,
  entityLabel,
  fieldLabel,
  formatAuditValue,
  isHiddenField,
} from "~/lib/audit-labels";
import { formatDateTime } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/audit")({
  component: AuditPage,
});

function AuditPage() {
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const list = useQuery({
    queryKey: ["audit.list", page],
    queryFn: () => orpc.audit.list({ page, pageSize }),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
        <p className="text-sm text-muted-foreground">
          Lückenlose Aufzeichnung aller Schreibvorgänge.
        </p>
      </div>
      <Card className="overflow-hidden p-0">
        <ul className="divide-y divide-border">
          {list.data?.rows.map((r) => (
            <AuditRow key={r.id} row={r as never} />
          ))}
        </ul>
        <div className="flex items-center justify-between border-t border-border bg-card px-4 py-3 text-sm">
          <span className="text-muted-foreground">{list.data?.total ?? 0} Einträge</span>
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
      </Card>
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
};

function AuditRow({ row }: { row: AuditRowData }) {
  const [open, setOpen] = useState(false);
  const visibleChanges = Object.entries(row.changes ?? {}).filter(([k]) => !isHiddenField(k));
  const summary = visibleChanges
    .slice(0, 4)
    .map(([k]) => fieldLabel(k))
    .join(", ");
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
            <span className="font-mono text-xs text-muted-foreground">
              {row.entityId.slice(0, 8)}
            </span>
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
