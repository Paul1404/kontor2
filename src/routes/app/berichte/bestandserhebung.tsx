import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Archive,
  Building2,
  Download,
  FileText,
  Loader2,
  Printer,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { DateField } from "~/components/ui/date-field";
import { exportBase64File, exportCsvFile } from "~/lib/export";
import { EMPTY_VALUE, formatDate, formatDateTime, orEmpty } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/berichte/bestandserhebung")({
  component: BestandserhebungPage,
});

const AGE_BUCKETS = [
  "0-6",
  "7-14",
  "15-18",
  "19-26",
  "27-40",
  "41-60",
  "61+",
  "unbekannt",
] as const;

function defaultStichtag(): string {
  const now = new Date();
  // LSB Bestandserhebung: Stichtag is always 1. Januar.
  return `${now.getUTCFullYear()}-01-01`;
}

function BestandserhebungPage() {
  const [stichtag, setStichtag] = useState(defaultStichtag);
  const [signedOff, setSignedOff] = useState(true);
  const [notes, setNotes] = useState("");
  const queryClient = useQueryClient();

  const me = useQuery({ queryKey: ["me"], queryFn: () => orpc.auth.me() });
  const role = me.data?.role ?? "readonly";
  const isAdmin = role === "admin";

  const data = useQuery({
    queryKey: ["verbandsmeldung.compute", { stichtag }],
    queryFn: () => orpc.verbandsmeldung.compute({ stichtag, abteilungIds: [] }),
  });

  const archived = useQuery({
    queryKey: ["verbandsmeldung.listArchived"],
    queryFn: () => orpc.verbandsmeldung.listArchived(),
  });

  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ["verbandsmeldung.getArchived", detailId],
    queryFn: () => orpc.verbandsmeldung.getArchived({ id: detailId as string }),
    enabled: detailId !== null,
  });

  const archive = useMutation({
    mutationFn: () => orpc.verbandsmeldung.archive({ stichtag, signedOff, notes }),
    onSuccess: async () => {
      setNotes("");
      await queryClient.invalidateQueries({ queryKey: ["verbandsmeldung.listArchived"] });
    },
  });

  function exportCsv() {
    return exportCsvFile(() => orpc.verbandsmeldung.exportCsv({ stichtag, abteilungIds: [] }));
  }

  function exportPdf() {
    return exportBase64File(
      () => orpc.verbandsmeldung.exportPdf({ stichtag, abteilungIds: [] }),
      "application/pdf",
      "PDF heruntergeladen",
    );
  }

  const cellMap = new Map<string, number>();
  for (const c of data.data?.cells ?? []) {
    cellMap.set(
      `${c.abteilungId}|${c.ageBucket}`,
      (cellMap.get(`${c.abteilungId}|${c.ageBucket}`) ?? 0) + c.count,
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Building2 className="size-6 text-brand" /> Bestandserhebung
          </h1>
          <p className="text-sm text-muted-foreground">
            Mitgliederzahlen je Abteilung, Geschlecht und Altersgruppe (LSB-Schema) zum gewählten
            Stichtag. CSV oder PDF zur Einreichung beim Landessportbund.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="size-4" /> Drucken
          </Button>
          <Button variant="outline" onClick={exportCsv}>
            <Download className="size-4" /> CSV
          </Button>
          <Button onClick={exportPdf}>
            <FileText className="size-4" /> PDF
          </Button>
        </div>
      </div>

      <Card className="print:hidden">
        <CardContent className="flex flex-wrap items-end gap-4 p-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="stichtag" className="text-xs font-medium text-muted-foreground">
              Stichtag
            </label>
            <DateField
              id="stichtag"
              value={stichtag}
              onChange={(v) => setStichtag(v)}
              className="w-44 tabular-nums"
            />
          </div>
          <div className="ml-auto text-sm text-muted-foreground">
            Mitglieder gesamt:{" "}
            <span className="font-semibold text-foreground">{data.data?.grandTotal ?? 0}</span>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Abteilung</th>
                <th className="px-4 py-3 font-medium">Sportart</th>
                <th className="px-4 py-3 text-right font-medium">m</th>
                <th className="px-4 py-3 text-right font-medium">w</th>
                <th className="px-4 py-3 text-right font-medium">d</th>
                {AGE_BUCKETS.map((b) => (
                  <th key={b} className="px-3 py-3 text-right font-medium">
                    {b}
                  </th>
                ))}
                <th className="px-4 py-3 text-right font-medium">Gesamt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.isLoading ? (
                <tr>
                  <td
                    colSpan={5 + AGE_BUCKETS.length + 1}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin" /> Wird berechnet…
                    </span>
                  </td>
                </tr>
              ) : !data.data || data.data.perAbteilung.length === 0 ? (
                <tr>
                  <td
                    colSpan={5 + AGE_BUCKETS.length + 1}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    Keine Abteilungen vorhanden.
                  </td>
                </tr>
              ) : (
                <>
                  {data.data.perAbteilung.map((a) => (
                    <tr key={a.abteilungId} className="transition-colors hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">{a.abteilungName}</td>
                      <td className="px-4 py-3 text-muted-foreground">{a.sportart ?? "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{a.male}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{a.female}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{a.divers}</td>
                      {AGE_BUCKETS.map((b) => (
                        <td key={b} className="px-3 py-3 text-right tabular-nums">
                          {cellMap.get(`${a.abteilungId}|${b}`) ?? 0}
                        </td>
                      ))}
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{a.total}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-border bg-muted/30 font-semibold">
                    <td className="px-4 py-3" colSpan={2}>
                      Gesamt
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {data.data.perAbteilung.reduce((s, a) => s + a.male, 0)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {data.data.perAbteilung.reduce((s, a) => s + a.female, 0)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {data.data.perAbteilung.reduce((s, a) => s + a.divers, 0)}
                    </td>
                    {AGE_BUCKETS.map((b) => {
                      const sum = data.data!.perAbteilung.reduce(
                        (s, a) => s + (cellMap.get(`${a.abteilungId}|${b}`) ?? 0),
                        0,
                      );
                      return (
                        <td key={b} className="px-3 py-3 text-right tabular-nums">
                          {sum}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-right tabular-nums">{data.data.grandTotal}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {isAdmin ? (
        <Card className="print:hidden">
          <CardContent className="flex flex-col gap-3 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Archive className="size-4 text-brand" /> Bestandserhebung archivieren
            </div>
            <p className="text-xs text-muted-foreground">
              Speichert die aktuelle Berechnung samt SHA-256 als Beleg. Mit Signoff ist sie für die
              Verbandsmeldung bestätigt.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={signedOff}
                  onChange={(e) => setSignedOff(e.target.checked)}
                />
                <ShieldCheck className="size-4 text-success" /> Signoff durch Vorstand
              </label>
              <input
                type="text"
                placeholder="Notiz (optional)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="h-10 flex-1 min-w-[200px] rounded-lg border border-input bg-card px-3 text-sm shadow-soft focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              />
              <Button
                onClick={() => archive.mutate()}
                disabled={archive.isPending || data.isLoading}
              >
                {archive.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Archive className="size-4" />
                )}
                Archivieren
              </Button>
            </div>
            {archive.isError ? (
              <div className="text-xs text-destructive">{(archive.error as Error).message}</div>
            ) : null}
            {archive.isSuccess ? (
              <div className="text-xs text-success">
                Gespeichert. SHA-256: {archive.data.sha256.slice(0, 16)}…
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="text-sm font-semibold">Archiv</div>
          {archived.isLoading ? (
            <div className="text-sm text-muted-foreground">
              <Loader2 className="inline size-4 animate-spin" /> Wird geladen…
            </div>
          ) : !archived.data || archived.data.length === 0 ? (
            <div className="text-sm text-muted-foreground">Noch keine Erhebungen archiviert.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="py-2 font-medium">Stichtag</th>
                    <th className="py-2 font-medium">Erstellt</th>
                    <th className="py-2 font-medium">Signoff</th>
                    <th className="py-2 font-medium">SHA-256</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {archived.data.map((row) => (
                    <tr key={row.id}>
                      <td className="py-2 font-medium">{String(row.stichtag)}</td>
                      <td className="py-2 text-muted-foreground">
                        {formatDateTime(row.createdAt)} · {orEmpty(row.createdByEmail)}
                      </td>
                      <td className="py-2">
                        {row.signedOff ? (
                          <span className="inline-flex items-center gap-1 text-success">
                            <ShieldCheck className="size-3" />{" "}
                            {row.signedOffAt ? formatDate(row.signedOffAt) : ""}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">offen</span>
                        )}
                      </td>
                      <td className="py-2 font-mono text-xs text-muted-foreground">
                        {row.deliverableSha256?.slice(0, 16) ?? "—"}…
                      </td>
                      <td className="py-2 text-right">
                        <Button variant="ghost" size="sm" onClick={() => setDetailId(row.id)}>
                          Details
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={detailId !== null}
        onOpenChange={(o) => {
          if (!o) setDetailId(null);
        }}
        title={
          detail.data ? `Bestandserhebung ${String(detail.data.stichtag)}` : "Bestandserhebung"
        }
        description="Details der archivierten Erhebung."
        confirmLabel="Schließen"
        cancelLabel="Schließen"
        onConfirm={() => setDetailId(null)}
      >
        {detail.isLoading ? (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Lade…
          </span>
        ) : detail.data ? (
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <DetailRow label="Stichtag">{String(detail.data.stichtag)}</DetailRow>
            <DetailRow label="Erstellt">
              {formatDateTime(detail.data.createdAt)} · {detail.data.createdByEmail ?? EMPTY_VALUE}
            </DetailRow>
            <DetailRow label="Signoff">
              {detail.data.signedOff
                ? `Ja${detail.data.signedOffAt ? ` · ${formatDateTime(detail.data.signedOffAt)}` : ""}${
                    detail.data.signedOffByEmail ? ` · ${detail.data.signedOffByEmail}` : ""
                  }`
                : "Offen"}
            </DetailRow>
            <DetailRow label="SHA-256">
              <span className="break-all font-mono text-xs">
                {detail.data.deliverableSha256 ?? EMPTY_VALUE}
              </span>
            </DetailRow>
            <div className="sm:col-span-2">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Notiz</dt>
              <dd className="mt-0.5 whitespace-pre-wrap">{detail.data.notes || EMPTY_VALUE}</dd>
            </div>
          </dl>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
