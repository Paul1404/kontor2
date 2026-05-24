import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Zeitpunkt</th>
                <th className="px-4 py-3 font-medium">Benutzer</th>
                <th className="px-4 py-3 font-medium">Aktion</th>
                <th className="px-4 py-3 font-medium">Quelle</th>
                <th className="px-4 py-3 font-medium">Entität</th>
                <th className="px-4 py-3 font-medium">Änderungen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.data?.rows.map((r) => (
                <tr key={r.id} className="align-top transition-colors hover:bg-muted/30">
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                    {formatDateTime(r.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-foreground">{r.actorEmail ?? "system"}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline">{r.action}</Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{r.source}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {r.entityType}:{r.entityId.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {Object.keys(r.changes ?? {})
                      .slice(0, 8)
                      .join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
