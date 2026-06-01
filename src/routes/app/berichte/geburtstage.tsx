import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Cake, Download, Loader2, Printer } from "lucide-react";
import { useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { QueryErrorRow } from "~/components/ui/query-error";
import { triggerDownload } from "~/lib/download";
import { formatDate } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/berichte/geburtstage")({
  component: GeburtstagePage,
});

const MONATS_NAMEN = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

function GeburtstagePage() {
  const today = new Date();
  const [month, setMonth] = useState(today.getUTCMonth() + 1);
  const [year, setYear] = useState(today.getUTCFullYear());
  const [abteilungId, setAbteilungId] = useState<string | null>(null);

  const abteilungen = useQuery({
    queryKey: ["abteilungen", "reports"],
    queryFn: () => orpc.reports.abteilungenList(),
  });

  const data = useQuery({
    queryKey: ["reports.geburtstage", { month, year, abteilungId }],
    queryFn: () => orpc.reports.geburtstage({ month, year, abteilungId }),
  });

  async function exportCsv() {
    const res = await orpc.reports.geburtstageExport({ month, year, abteilungId });
    triggerDownload(res.filename, res.content, "text/csv;charset=utf-8");
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Cake className="size-6 text-brand" /> Geburtstagsliste
          </h1>
          <p className="text-sm text-muted-foreground">
            Mitglieder mit Geburtstag im gewählten Monat. Runde Geburtstage sind markiert.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="size-4" /> Drucken
          </Button>
          <Button onClick={exportCsv}>
            <Download className="size-4" /> Als CSV exportieren
          </Button>
        </div>
      </div>

      <Card className="print:hidden">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="h-10 rounded-lg border border-input bg-card px-3 text-sm shadow-soft focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            {MONATS_NAMEN.map((name, idx) => (
              <option key={name} value={idx + 1}>
                {name}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={1900}
            max={2200}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="h-10 w-28 rounded-lg border border-input bg-card px-3 text-sm shadow-soft tabular-nums focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          />
          <select
            value={abteilungId ?? ""}
            onChange={(e) => setAbteilungId(e.target.value || null)}
            className="h-10 rounded-lg border border-input bg-card px-3 text-sm shadow-soft focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            <option value="">Alle Abteilungen</option>
            {abteilungen.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      <div className="hidden print:block">
        <h1 className="text-xl font-semibold">
          Geburtstage {MONATS_NAMEN[month - 1]} {year}
        </h1>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Tag</th>
                <th className="px-4 py-3 font-medium">Mitgl.-Nr.</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Geburtsdatum</th>
                <th className="px-4 py-3 font-medium">Alter</th>
                <th className="px-4 py-3 font-medium">Ort</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin" /> Wird geladen…
                    </span>
                  </td>
                </tr>
              ) : data.isError ? (
                <QueryErrorRow colSpan={6} onRetry={() => data.refetch()} />
              ) : !data.data || data.data.rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    Keine Geburtstage im gewählten Monat.
                  </td>
                </tr>
              ) : (
                data.data.rows.map((r) => (
                  <tr key={r.id} className="transition-colors hover:bg-muted/30">
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">{r.tag}.</td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {r.mitglnr ?? "-"}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {[r.nachname, r.vorname].filter(Boolean).join(", ")}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{formatDate(r.geburtsdatum)}</td>
                    <td className="px-4 py-3 tabular-nums">
                      <span className="inline-flex items-center gap-2">
                        {r.alter}
                        {r.rund ? (
                          <Badge
                            variant="warning"
                            className="print:bg-transparent print:text-foreground print:border print:border-current"
                          >
                            rund
                          </Badge>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{r.ort ?? ""}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
