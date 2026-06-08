import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Award, Check, Download, Loader2, Printer, Trophy } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { InfoBox } from "~/components/ui/info-box";
import { QueryError } from "~/components/ui/query-error";
import { toast } from "~/components/ui/toaster";
import { triggerDownloadBase64 } from "~/lib/download";
import { STANDARD_JUBILAEEN } from "~/lib/ehrungen";
import { exportCsvFile } from "~/lib/export";
import { EMPTY_VALUE, formatDate } from "~/lib/format";
import { memberRef } from "~/lib/member-ref";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/berichte/ehrungen")({
  component: EhrungenPage,
});

const ALL_JUBILAEEN = [...STANDARD_JUBILAEEN];

function honorKey(memberId: string, jubilee: number): string {
  return `${memberId}:${jubilee}`;
}

function EhrungenPage() {
  const qc = useQueryClient();
  const [year, setYear] = useState(new Date().getUTCFullYear());
  const [selected, setSelected] = useState<number[]>(ALL_JUBILAEEN);

  const me = useQuery({ queryKey: ["me"], queryFn: () => orpc.auth.me() });
  const canEdit = me.data?.role === "vorstand" || me.data?.role === "admin";

  const data = useQuery({
    queryKey: ["reports.ehrungen", { year, selected }],
    queryFn: () => orpc.reports.ehrungen({ year, jubilaeen: selected }),
  });

  const status = useQuery({
    queryKey: ["ehrungen.statusForYear", { year, selected }],
    queryFn: () => orpc.ehrungen.statusForYear({ year, jubilaeen: selected }),
  });

  // Lookup of recorded honors by member + jubilee, so each due row shows open
  // vs honored without an extra request per row.
  const honored = useMemo(() => {
    const map = new Map<
      string,
      { ehrungId: string; verliehenAm: string | null; hasUrkunde: boolean }
    >();
    for (const h of status.data?.honored ?? []) {
      if (h.jubilaeumJahre == null) continue;
      map.set(honorKey(h.memberId, h.jubilaeumJahre), {
        ehrungId: h.ehrungId,
        verliehenAm: h.verliehenAm,
        hasUrkunde: h.hasUrkunde,
      });
    }
    return map;
  }, [status.data]);

  const invalidateStatus = () =>
    qc.invalidateQueries({ queryKey: ["ehrungen.statusForYear", { year, selected }] });

  const record = useMutation({
    mutationFn: (vars: { memberId: string; jubilee: number }) =>
      orpc.ehrungen.record({
        memberId: vars.memberId,
        kind: "vereinsjubilaeum",
        jubilaeumJahre: vars.jubilee,
        verliehenAm: new Date().toISOString().slice(0, 10),
        jahr: year,
      }),
    onSuccess: async () => {
      await invalidateStatus();
      toast.success("Als geehrt vermerkt");
    },
    onError: (e: Error) => toast.error("Konnte nicht vermerkt werden", { description: e.message }),
  });

  const urkunde = useMutation({
    mutationFn: (id: string) => orpc.ehrungen.urkunde({ id }),
    onSuccess: async (r) => {
      triggerDownloadBase64(r.filename, r.base64, "application/pdf");
      await invalidateStatus();
    },
    onError: (e: Error) => toast.error("Urkunde fehlgeschlagen", { description: e.message }),
  });

  function toggle(j: number) {
    setSelected((prev) =>
      prev.includes(j) ? prev.filter((x) => x !== j) : [...prev, j].sort((a, b) => a - b),
    );
  }

  function exportCsv() {
    return exportCsvFile(() => orpc.reports.ehrungenExport({ year, jubilaeen: selected }));
  }

  const busy = record.isPending || urkunde.isPending;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Trophy className="size-6 text-brand" /> Ehrungen
          </h1>
          <p className="text-sm text-muted-foreground">
            Mitglieder mit anstehendem Vereinsjubiläum (25, 40, 50 Jahre und mehr) im gewählten
            Jahr. Erfasste Ehrungen lassen sich als Urkunde drucken.
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
          Mit „Als geehrt vermerken“ halten Sie fest, dass die Ehrung vergeben wurde. Danach lässt
          sich die Ehrenurkunde als PDF erzeugen. Bereits vermerkte Jubiläen erscheinen mit einem
          Haken, damit niemand doppelt geehrt wird.
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
                      <th className="px-4 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {g.members.map((m) => {
                      const honor = honored.get(honorKey(m.id, g.jubilee));
                      return (
                        <tr key={m.id} className="transition-colors hover:bg-muted/30">
                          <td className="px-4 py-3 tabular-nums text-muted-foreground">
                            {memberRef(m)}
                          </td>
                          <td className="px-4 py-3 font-medium">
                            {[m.nachname, m.vorname].filter(Boolean).join(", ")}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {m.ort || EMPTY_VALUE}
                          </td>
                          <td className="px-4 py-3 tabular-nums">{formatDate(m.eintritt)}</td>
                          <td className="px-4 py-3 tabular-nums">
                            {formatDate(m.jubilaeumsDatum)}
                          </td>
                          <td className="px-4 py-3">
                            {honor ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="success" className="gap-1">
                                  <Check className="size-3" /> Geehrt
                                  {honor.verliehenAm ? ` ${formatDate(honor.verliehenAm)}` : ""}
                                </Badge>
                                {canEdit ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="print:hidden"
                                    disabled={busy}
                                    onClick={() => urkunde.mutate(honor.ehrungId)}
                                    title="Ehrenurkunde erzeugen und herunterladen"
                                  >
                                    <Award className="size-4" /> Urkunde
                                  </Button>
                                ) : null}
                              </div>
                            ) : canEdit ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="print:hidden"
                                disabled={busy}
                                onClick={() =>
                                  record.mutate({ memberId: m.id, jubilee: g.jubilee })
                                }
                              >
                                Als geehrt vermerken
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">offen</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ))
      )}
    </div>
  );
}
