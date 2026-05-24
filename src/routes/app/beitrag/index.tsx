import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Coins, Download, Loader2, Plus } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { triggerDownload } from "~/lib/download";
import { formatCurrency, formatDate, formatDateTime } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/beitrag/")({
  component: FeeRunsListPage,
});

type RunRow = {
  id: string;
  billingYear: number;
  falligkeitsdatum: string;
  status: "draft" | "committed" | "submitted" | "cancelled";
  itemCount: number;
  totalAmount: string;
  xmlFilename: string | null;
  createdAt: string | Date;
  committedAt: string | Date | null;
  cancelledAt: string | Date | null;
  notes: string | null;
};

function FeeRunsListPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => orpc.auth.me() });
  const canRun = me.data?.role === "vorstand" || me.data?.role === "admin";
  const list = useQuery({
    queryKey: ["feeRuns.list"],
    queryFn: () => orpc.feeRuns.list({ limit: 50, offset: 0 }),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Coins className="size-6 text-brand" /> Beitragsläufe
          </h1>
          <p className="text-sm text-muted-foreground">
            SEPA-Lastschriftläufe: pain.008-Dateien für den Bankupload.
          </p>
        </div>
        {canRun ? (
          <Link to="/app/beitrag/neu">
            <Button>
              <Plus className="size-4" /> Neuer Lauf
            </Button>
          </Link>
        ) : null}
      </div>

      <Card>
        <CardContent className="p-0">
          {list.isLoading ? (
            <div className="flex items-center justify-center gap-2 p-12 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" /> Lade...
            </div>
          ) : !list.data || list.data.rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 p-12 text-center text-muted-foreground">
              <Coins className="size-8 opacity-40" />
              <div className="text-sm">Noch keine Beitragsläufe.</div>
              {canRun ? (
                <Link
                  to="/app/beitrag/neu"
                  className="text-sm font-medium text-brand hover:underline"
                >
                  Ersten Lauf erstellen →
                </Link>
              ) : null}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Jahr</th>
                    <th className="px-4 py-3 font-medium">Fälligkeit</th>
                    <th className="px-4 py-3 font-medium">Posten</th>
                    <th className="px-4 py-3 text-right font-medium">Summe</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Erstellt</th>
                    <th className="px-4 py-3 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {(list.data.rows as RunRow[]).map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-b-0">
                      <td className="px-4 py-3 font-medium tabular-nums">{r.billingYear}</td>
                      <td className="px-4 py-3 tabular-nums">{formatDate(r.falligkeitsdatum)}</td>
                      <td className="px-4 py-3 tabular-nums">{r.itemCount}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatCurrency(r.totalAmount)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {formatDateTime(r.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Link to="/app/beitrag/$id" params={{ id: r.id }}>
                            <Button variant="ghost" size="sm">
                              Details
                            </Button>
                          </Link>
                          {r.xmlFilename && r.status !== "cancelled" && canRun ? (
                            <DownloadButton runId={r.id} filename={r.xmlFilename} />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: RunRow["status"] }) {
  const map = {
    draft: { label: "Entwurf", variant: "secondary" as const },
    committed: { label: "Erzeugt", variant: "default" as const },
    submitted: { label: "Übermittelt", variant: "default" as const },
    cancelled: { label: "Storniert", variant: "secondary" as const },
  };
  const cfg = map[status];
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

function DownloadButton({ runId, filename }: { runId: string; filename: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        const res = await orpc.feeRuns.downloadXml({ id: runId });
        triggerDownload(res.filename ?? filename, res.content, "application/xml");
      }}
    >
      <Download className="size-4" /> XML
    </Button>
  );
}
