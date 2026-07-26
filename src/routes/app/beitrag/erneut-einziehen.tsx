import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Download, Loader2, RotateCcw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { DateField } from "~/components/ui/date-field";
import { InfoBox } from "~/components/ui/info-box";
import { Input } from "~/components/ui/input";
import { QueryError } from "~/components/ui/query-error";
import { SkeletonText } from "~/components/ui/skeleton";
import { toast } from "~/components/ui/toaster";
import { triggerDownload } from "~/lib/download";
import { formatCurrency } from "~/lib/format";
import { memberRef } from "~/lib/member-ref";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/beitrag/erneut-einziehen")({
  component: RecollectPage,
});

function RecollectPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [falligkeitsdatum, setFalligkeitsdatum] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [confirmOpen, setConfirmOpen] = useState(false);

  const candidates = useQuery({
    queryKey: ["feeRuns.recollectCandidates", query],
    queryFn: () => orpc.feeRuns.recollectCandidates({ query: query.trim() || null, limit: 200 }),
  });

  const eligibleIds = useMemo(
    () => (candidates.data ?? []).filter((c) => c.eligible).map((c) => c.sollStellungId),
    [candidates.data],
  );
  const selectedTotal = useMemo(() => {
    const rows = candidates.data ?? [];
    let cents = 0;
    for (const r of rows) {
      if (selected.has(r.sollStellungId)) cents += Math.round(Number.parseFloat(r.amount) * 100);
    }
    return (cents / 100).toFixed(2);
  }, [candidates.data, selected]);

  const recollect = useMutation({
    mutationFn: () => orpc.feeRuns.recollect({ sollStellungIds: [...selected], falligkeitsdatum }),
    onSuccess: async (r) => {
      const skippedNote = r.skipped.length > 0 ? ` ${r.skipped.length} übersprungen.` : "";
      toast.success(
        `${r.itemCount} Posten für die Bankdatei vorbereitet (${formatCurrency(r.totalAmount)}).${skippedNote}`,
      );
      setSelected(new Set());
      setConfirmOpen(false);
      qc.invalidateQueries({ queryKey: ["feeRuns.recollectCandidates"] });
      qc.invalidateQueries({ queryKey: ["feeRuns.list"] });
      qc.invalidateQueries({ queryKey: ["dunning.open"] });
      qc.invalidateQueries({ queryKey: ["sepaReturns.candidates"] });
      // Hand the operator the XML right away, then open the run detail.
      try {
        const xml = await orpc.feeRuns.downloadXml({ id: r.feeRunId });
        triggerDownload(xml.filename ?? r.xmlFilename, xml.content, "application/xml");
      } catch {
        // Download is best effort; the file stays available on the run detail.
      }
      navigate({ to: "/app/beitrag/$id", params: { id: r.feeRunId } });
    },
    onError: (e: Error) => {
      setConfirmOpen(false);
      toast.error("Wiedereinzug fehlgeschlagen", { description: e.message });
    },
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === eligibleIds.length ? new Set() : new Set(eligibleIds)));
  }

  const rows = candidates.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link to="/app/beitrag" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-3" /> Beitragsläufe
          </Link>
        </div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
          <RotateCcw className="size-6 text-brand" /> Erneut einziehen
        </h1>
        <p className="text-sm text-muted-foreground">
          Zurückgelastete Sollstellungen erneut per SEPA einziehen, etwa nach einer korrigierten
          IBAN. Die ursprüngliche Sollstellung bleibt erhalten und wird erst nach bestätigter
          Bankübermittlung wieder als eingezogen gebucht.
        </p>
      </div>

      <InfoBox title="Wann brauche ich das?" collapsible defaultOpen={false}>
        <p>
          Wenn eine Lastschrift zurückkam (Rücklastschrift), steht die Sollstellung wieder offen.
          Der normale Beitragslauf zieht sie nicht erneut ein. Korrigieren Sie zuerst beim Mitglied
          die IBAN oder hinterlegen Sie ein gültiges SEPA-Mandat, wählen Sie den Posten hier aus und
          erzeugen Sie eine neue pain.008-Datei für den Bankupload.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Posten ohne aktives Mandat, ohne IBAN, mit ausgesetztem Einzug oder ohne
          Lastschrift-Vertrag lassen sich nicht auswählen. Der Grund steht jeweils dahinter.
        </p>
      </InfoBox>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Offene Rückläufer</CardTitle>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name oder Mitgliedsnummer"
              className="pl-8"
            />
          </div>
        </CardHeader>
        <CardContent>
          {candidates.isLoading ? (
            <SkeletonText lines={5} className="max-w-md" />
          ) : candidates.isError ? (
            <QueryError onRetry={() => candidates.refetch()} />
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Keine offenen Rückläufer. Nichts erneut einzuziehen.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label="Alle einziehbaren auswählen"
                        checked={eligibleIds.length > 0 && selected.size === eligibleIds.length}
                        disabled={eligibleIds.length === 0}
                        onChange={toggleAll}
                      />
                    </th>
                    <th className="px-3 py-2 font-medium">Mitglied</th>
                    <th className="px-3 py-2 font-medium">Jahr</th>
                    <th className="px-3 py-2 text-right font-medium">Betrag</th>
                    <th className="px-3 py-2 font-medium">Mandat</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.sollStellungId} className="border-b border-border last:border-b-0">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label={`${c.memberName} auswählen`}
                          disabled={!c.eligible}
                          checked={selected.has(c.sollStellungId)}
                          onChange={() => toggle(c.sollStellungId)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          to="/app/mitglieder/$mitgliedsnummer"
                          params={{ mitgliedsnummer: memberRef(c) }}
                          className="font-medium hover:underline"
                        >
                          {c.memberName}
                        </Link>
                        <div className="text-xs text-muted-foreground tabular-nums">
                          #{memberRef(c)}
                          {c.artName ? ` · ${c.artName}` : ""}
                        </div>
                      </td>
                      <td className="px-3 py-2 tabular-nums">{c.billingYear}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(c.amount)}
                      </td>
                      <td className="px-3 py-2">
                        {c.mandateRef ? (
                          <span className="text-xs">
                            {c.mandateRef}
                            {c.iban1Last4 ? (
                              <span className="text-muted-foreground"> · ****{c.iban1Last4}</span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {c.eligible ? (
                          <Badge variant="success">einziehbar</Badge>
                        ) : (
                          <Badge variant="warning">{c.blockReason}</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {selected.size > 0 ? (
        <Card>
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:justify-between">
            {/* biome-ignore lint/a11y/noLabelWithoutControl: the date Input is the label's child and is implicitly associated. */}
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Fälligkeitsdatum
              </span>
              <DateField
                value={falligkeitsdatum}
                onChange={(v) => setFalligkeitsdatum(v)}
                className="w-44"
              />
            </label>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-xs text-muted-foreground">{selected.size} Posten</div>
                <div className="text-lg font-semibold tabular-nums">
                  {formatCurrency(selectedTotal)}
                </div>
              </div>
              <Button disabled={recollect.isPending} onClick={() => setConfirmOpen(true)}>
                {recollect.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
                Erzeugen
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(o) => {
          if (!o && !recollect.isPending) setConfirmOpen(false);
        }}
        title="Erneut einziehen?"
        description={`${selected.size} Rückläufer (${formatCurrency(selectedTotal)}) werden in eine neue pain.008-Datei aufgenommen. Die XML-Datei wird anschließend heruntergeladen. Als eingezogen gelten die Posten erst nach der Bestätigung im Lauf.`}
        confirmLabel="Erzeugen"
        loading={recollect.isPending}
        onConfirm={() => recollect.mutate()}
      />
    </div>
  );
}
