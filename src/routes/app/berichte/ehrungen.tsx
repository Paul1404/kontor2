import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Download, Loader2, Printer, Trophy } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { InfoBox } from "~/components/ui/info-box";
import { QueryError } from "~/components/ui/query-error";
import { exportCsvFile } from "~/lib/export";
import { formatDate } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/berichte/ehrungen")({
  component: EhrungenPage,
});

const ALL_JUBILAEEN = [25, 40, 50, 60, 70, 75];

function EhrungenPage() {
  const [year, setYear] = useState(new Date().getUTCFullYear());
  const [selected, setSelected] = useState<number[]>(ALL_JUBILAEEN);

  const data = useQuery({
    queryKey: ["reports.ehrungen", { year, selected }],
    queryFn: () => orpc.reports.ehrungen({ year, jubilaeen: selected }),
  });

  function toggle(j: number) {
    setSelected((prev) =>
      prev.includes(j) ? prev.filter((x) => x !== j) : [...prev, j].sort((a, b) => a - b),
    );
  }

  function exportCsv() {
    return exportCsvFile(() => orpc.reports.ehrungenExport({ year, jubilaeen: selected }));
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Trophy className="size-6 text-brand" /> Ehrungen
          </h1>
          <p className="text-sm text-muted-foreground">
            Mitglieder mit anstehendem Vereinsjubiläum (25, 40, 50 Jahre und mehr) im gewählten
            Jahr.
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

      <InfoBox
        className="print:hidden"
        collapsible
        defaultOpen={false}
        title="Was wird hier gelistet?"
      >
        <p>
          Es geht um <strong>Vereinsjubiläen</strong>, nicht um Geburtstage. Grundlage ist das
          Eintrittsdatum: Ein Mitglied mit Eintritt 1975 hat im Jahr 2025 sein 50-jähriges
          Vereinsjubiläum. Geburtstage finden Sie unter <em>Geburtstage</em>.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Die Schalter oben filtern, welche Jubiläumsjahre berücksichtigt werden. Standardmäßig sind
          alle aktiv. CSV-Export ist für die Erstellung von Urkunden und die Übergabe an die
          Geehrten-Verwaltung gedacht.
        </p>
      </InfoBox>

      <Card className="print:hidden">
        <CardContent className="flex flex-wrap items-center gap-4 p-4">
          <input
            type="number"
            min={1900}
            max={2200}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="h-10 w-28 rounded-lg border border-input bg-card px-3 text-sm shadow-soft tabular-nums focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          />
          <div className="flex flex-wrap items-center gap-2">
            {ALL_JUBILAEEN.map((j) => {
              const on = selected.includes(j);
              return (
                <button
                  key={j}
                  type="button"
                  onClick={() => toggle(j)}
                  className={
                    "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors " +
                    (on
                      ? "border-brand bg-brand/10 text-brand"
                      : "border-input bg-card text-muted-foreground hover:bg-accent")
                  }
                >
                  {j} Jahre
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="hidden print:block">
        <h1 className="text-xl font-semibold">Ehrungen {year}</h1>
      </div>

      {data.isLoading ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 p-12 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" /> Lade...
          </CardContent>
        </Card>
      ) : data.isError ? (
        <QueryError error={data.error} onRetry={() => data.refetch()} />
      ) : !data.data || data.data.groups.every((g) => g.members.length === 0) ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 p-12 text-center text-muted-foreground">
            <Trophy className="size-8 opacity-40" />
            <div className="text-sm">Keine Ehrungen im gewählten Jahr.</div>
          </CardContent>
        </Card>
      ) : (
        data.data.groups
          .filter((g) => g.members.length > 0)
          .map((g) => (
            <Card key={g.jubilee} className="overflow-hidden p-0">
              <div className="border-b border-border bg-muted/40 px-4 py-3 text-sm font-semibold">
                {g.jubilee} Jahre · {g.members.length} Mitglied
                {g.members.length === 1 ? "" : "er"}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Mitgl.-Nr.</th>
                      <th className="px-4 py-3 font-medium">Name</th>
                      <th className="px-4 py-3 font-medium">Ort</th>
                      <th className="px-4 py-3 font-medium">Eintritt</th>
                      <th className="px-4 py-3 font-medium">Jubiläumsdatum</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {g.members.map((m) => (
                      <tr key={m.id} className="transition-colors hover:bg-muted/30">
                        <td className="px-4 py-3 tabular-nums text-muted-foreground">
                          {m.mitgliedsnummer ?? "-"}
                        </td>
                        <td className="px-4 py-3 font-medium">
                          {[m.nachname, m.vorname].filter(Boolean).join(", ")}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{m.ort ?? ""}</td>
                        <td className="px-4 py-3 tabular-nums">{formatDate(m.eintritt)}</td>
                        <td className="px-4 py-3 tabular-nums">{formatDate(m.jubilaeumsDatum)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))
      )}
    </div>
  );
}
