import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BarChart3, Download, Loader2, Printer } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { QueryErrorRow } from "~/components/ui/query-error";
import { exportCsvFile } from "~/lib/export";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/berichte/abteilungs-statistik")({
  component: AbteilungsStatistikPage,
});

function AbteilungsStatistikPage() {
  const [year, setYear] = useState(new Date().getUTCFullYear());

  const data = useQuery({
    queryKey: ["reports.abteilungStats", { year }],
    queryFn: () => orpc.reports.abteilungStats({ year }),
  });

  function exportCsv() {
    return exportCsvFile(() => orpc.reports.abteilungStatsExport({ year }));
  }

  const sum = (data.data?.rows ?? []).reduce(
    (acc, r) => {
      acc.aktiv += r.aktivCount;
      acc.joiners += r.joiners;
      acc.leavers += r.leavers;
      return acc;
    },
    { aktiv: 0, joiners: 0, leavers: 0 },
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <BarChart3 className="size-6 text-brand" /> Abteilungs-Statistik
          </h1>
          <p className="text-sm text-muted-foreground">
            Aktive Mitglieder, Eintritte und Austritte je Abteilung im gewählten Jahr.
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
          <input
            type="number"
            min={1900}
            max={2200}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="h-10 w-28 rounded-lg border border-input bg-card px-3 text-sm shadow-soft tabular-nums focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        </CardContent>
      </Card>

      <div className="hidden print:block">
        <h1 className="text-xl font-semibold">Abteilungs-Statistik {year}</h1>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Abteilung</th>
                <th className="px-4 py-3 text-right font-medium">Aktive</th>
                <th className="px-4 py-3 text-right font-medium">Eintritte {year}</th>
                <th className="px-4 py-3 text-right font-medium">Austritte {year}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.isLoading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin" /> Wird geladen…
                    </span>
                  </td>
                </tr>
              ) : data.isError ? (
                <QueryErrorRow colSpan={4} onRetry={() => data.refetch()} />
              ) : !data.data || data.data.rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    Keine Abteilungen vorhanden.
                  </td>
                </tr>
              ) : (
                <>
                  {data.data.rows.map((r) => (
                    <tr key={r.abteilungId} className="transition-colors hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">{r.name}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.aktivCount}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-success">
                        +{r.joiners}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        -{r.leavers}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-border bg-muted/30 font-semibold">
                    <td className="px-4 py-3">Gesamt</td>
                    <td className="px-4 py-3 text-right tabular-nums">{sum.aktiv}</td>
                    <td className="px-4 py-3 text-right tabular-nums">+{sum.joiners}</td>
                    <td className="px-4 py-3 text-right tabular-nums">-{sum.leavers}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
