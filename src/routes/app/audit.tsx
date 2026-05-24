import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "~/components/ui/badge";
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
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-4 py-2">Zeitpunkt</th>
                <th className="px-4 py-2">Benutzer</th>
                <th className="px-4 py-2">Aktion</th>
                <th className="px-4 py-2">Quelle</th>
                <th className="px-4 py-2">Entität</th>
                <th className="px-4 py-2">Änderungen</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.rows.map((r) => (
                <tr key={r.id} className="border-t align-top">
                  <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                    {formatDateTime(r.createdAt)}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{r.actorEmail ?? "system"}</td>
                  <td className="px-4 py-2"><Badge variant="outline">{r.action}</Badge></td>
                  <td className="px-4 py-2 text-muted-foreground">{r.source}</td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {r.entityType}:{r.entityId.slice(0, 8)}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {Object.keys(r.changes ?? {}).slice(0, 8).join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t p-3 text-sm">
          <span className="text-muted-foreground">{list.data?.total ?? 0} Einträge</span>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md border px-3 py-1 disabled:opacity-50"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Zurück
            </button>
            <span>Seite {page}</span>
            <button
              type="button"
              className="rounded-md border px-3 py-1 disabled:opacity-50"
              disabled={(list.data?.rows.length ?? 0) < pageSize}
              onClick={() => setPage((p) => p + 1)}
            >
              Weiter
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
