import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Coins, Download, Loader2, Printer } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { InfoBox } from "~/components/ui/info-box";
import { QueryError } from "~/components/ui/query-error";
import { exportCsvFile } from "~/lib/export";
import { formatCurrency } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/berichte/finanzen")({
  component: FinanzenPage,
});

function FinanzenPage() {
  const [year, setYear] = useState(new Date().getUTCFullYear());

  const data = useQuery({
    queryKey: ["reports.finanzbericht", { year }],
    queryFn: () => orpc.reports.finanzbericht({ year }),
  });

  function exportCsv() {
    return exportCsvFile(() => orpc.reports.finanzberichtExport({ year }));
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Coins className="size-6 text-brand" /> Finanzbericht
          </h1>
          <p className="text-sm text-muted-foreground">
            Soll, Bezahlt und Offen je Beitragsjahr aus den Sollstellungen.
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
        title="Wie liest sich der Bericht?"
      >
        <ul className="space-y-1">
          <li>
            <strong>Soll</strong>: Summe aller Sollstellungen, die im gewählten Jahr fällig geworden
            sind. Sollstellungen entstehen aus Beitragsläufen.
          </li>
          <li>
            <strong>Bezahlt</strong>: Bereits ausgeglichene Sollstellungen (volle und teilweise
            Zahlungen).
          </li>
          <li>
            <strong>Offen</strong>: Differenz aus Soll und Bezahlt. Diese Posten erscheinen unter{" "}
            <em>Forderungen</em> und sind Kandidaten für Mahnungen.
          </li>
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          Die Zahlen werden live aus den Sollstellungen ermittelt, es gibt keinen Buchungslauf
          dazwischen. Stornierte Beitragsläufe fließen nicht in das Soll ein. CSV-Export eignet sich
          für die Jahresabschluss-Buchhaltung.
        </p>
      </InfoBox>

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
        <h1 className="text-xl font-semibold">Finanzbericht {year}</h1>
      </div>

      {data.isLoading ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 p-12 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" /> Lade…
          </CardContent>
        </Card>
      ) : data.isError ? (
        <QueryError error={data.error} onRetry={() => data.refetch()} />
      ) : !data.data ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">Keine Daten.</CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 print:grid-cols-4">
            <KpiCard label="Soll gesamt" value={formatCurrency(data.data.totals.billed)} />
            <KpiCard label="Bezahlt" value={formatCurrency(data.data.totals.paid)} />
            <KpiCard label="Offen" value={formatCurrency(data.data.totals.open)} />
            <KpiCard label="Posten" value={String(data.data.totals.count)} />
          </div>

          <Card className="overflow-hidden p-0">
            <div className="border-b border-border bg-muted/40 px-4 py-3 text-sm font-semibold">
              Nach Abteilung
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Abteilung</th>
                    <th className="px-4 py-3 text-right font-medium">Posten</th>
                    <th className="px-4 py-3 text-right font-medium">Soll</th>
                    <th className="px-4 py-3 text-right font-medium">Bezahlt</th>
                    <th className="px-4 py-3 text-right font-medium">Offen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.data.perAbteilung.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                        Keine Posten in diesem Jahr.
                      </td>
                    </tr>
                  ) : (
                    data.data.perAbteilung.map((r) => (
                      <tr key={r.abteilung} className="transition-colors hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium">{r.abteilung}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{r.count}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {formatCurrency(r.billed)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {formatCurrency(r.paid)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {formatCurrency(r.open)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="border-b border-border bg-muted/40 px-4 py-3 text-sm font-semibold">
              Nach Beitragsart
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Beitragsart</th>
                    <th className="px-4 py-3 text-right font-medium">Posten</th>
                    <th className="px-4 py-3 text-right font-medium">Soll</th>
                    <th className="px-4 py-3 text-right font-medium">Bezahlt</th>
                    <th className="px-4 py-3 text-right font-medium">Offen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.data.perFeeType.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                        Keine Posten in diesem Jahr.
                      </td>
                    </tr>
                  ) : (
                    data.data.perFeeType.map((r) => (
                      <tr key={r.art} className="transition-colors hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <div className="font-medium">{r.bezeichnung ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">Art {r.art}</div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{r.count}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {formatCurrency(r.billed)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {formatCurrency(r.paid)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {formatCurrency(r.open)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="text-xl font-semibold tabular-nums">{value}</span>
      </CardContent>
    </Card>
  );
}
