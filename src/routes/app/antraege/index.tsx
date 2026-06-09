import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Inbox, Loader2, Search } from "lucide-react";
import { useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { QueryError } from "~/components/ui/query-error";
import { cn } from "~/lib/cn";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/antraege/")({
  component: AntraegeListPage,
});

type StatusFilter =
  | "alle"
  | "neu"
  | "dokument_hochgeladen"
  | "in_bearbeitung"
  | "genehmigt"
  | "abgelehnt";

const STATUS_LABELS: Record<string, string> = {
  neu: "Eingegangen",
  scan_eingegangen: "Scan eingegangen",
  dokument_hochgeladen: "Dokument hochgeladen",
  in_bearbeitung: "In Bearbeitung",
  genehmigt: "Genehmigt",
  abgelehnt: "Abgelehnt",
};

const STATUS_TONE: Record<string, string> = {
  genehmigt: "bg-success/15 text-success",
  abgelehnt: "bg-destructive/15 text-destructive",
  in_bearbeitung: "bg-primary/15 text-primary",
};

const TABS: { key: StatusFilter; label: string }[] = [
  { key: "alle", label: "Alle" },
  { key: "neu", label: "Neu" },
  { key: "dokument_hochgeladen", label: "Dokument" },
  { key: "in_bearbeitung", label: "In Bearbeitung" },
  { key: "genehmigt", label: "Genehmigt" },
  { key: "abgelehnt", label: "Abgelehnt" },
];

function AntraegeListPage() {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<StatusFilter>("alle");

  const list = useQuery({
    queryKey: ["applications.list", q, tab],
    queryFn: () =>
      orpc.applications.list({
        q,
        status: tab === "alle" ? null : tab,
        page: 1,
        pageSize: 100,
      }),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Inbox className="size-6 text-brand" />
        <h1 className="text-2xl font-semibold tracking-tight">Anträge</h1>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm transition-colors",
              tab === t.key
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:border-ring/40",
            )}
          >
            {t.label}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search className="-translate-y-1/2 absolute top-1/2 left-3 size-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Suche…"
            className="pl-9"
            aria-label="Anträge durchsuchen"
          />
        </div>
      </div>

      {list.isError ? (
        <QueryError
          title="Anträge konnten nicht geladen werden"
          error={list.error}
          onRetry={() => list.refetch()}
        />
      ) : list.isLoading ? (
        <div className="flex min-h-[30vh] items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : list.data && list.data.rows.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Antragsnummer</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Typ</th>
                  <th className="px-4 py-3">Beitrag</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <Link
                        to="/app/antraege/$id"
                        params={{ id: r.id }}
                        className="font-medium text-primary hover:underline"
                      >
                        {r.antragsnummer}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {r.vorname} {r.nachname}
                      {r.isTest ? (
                        <span className="ml-2 text-xs text-muted-foreground">(Test)</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 capitalize">{r.antragstyp}</td>
                    <td className="px-4 py-3">{r.jahresbeitrag ? `${r.jahresbeitrag} €` : "—"}</td>
                    <td className="px-4 py-3">
                      <Badge className={cn("font-normal", STATUS_TONE[r.status] ?? "")}>
                        {STATUS_LABELS[r.status] ?? r.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">Keine Anträge gefunden.</p>
      )}
    </div>
  );
}
