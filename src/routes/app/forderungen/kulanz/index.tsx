import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, Download, FileText, HeartHandshake, MailX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { DateField } from "~/components/ui/date-field";
import { InfoBox } from "~/components/ui/info-box";
import { QueryError } from "~/components/ui/query-error";
import { SkeletonText } from "~/components/ui/skeleton";
import { Switch } from "~/components/ui/switch";
import { toast } from "~/components/ui/toaster";
import { triggerDownloadBase64 } from "~/lib/download";
import { formatCurrency, formatDate } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/forderungen/kulanz/")({
  component: KulanzPage,
});

function sumDec(values: string[]): string {
  let cents = 0;
  for (const v of values) cents += Math.round(Number.parseFloat(v) * 100);
  return (cents / 100).toFixed(2);
}

function KulanzPage() {
  const qc = useQueryClient();
  const [onlyWithoutEmail, setOnlyWithoutEmail] = useState(true);
  const [waiveReturnFee, setWaiveReturnFee] = useState(false);
  const [mitUnterschrift, setMitUnterschrift] = useState(true);
  const [deadline, setDeadline] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const preview = useQuery({
    queryKey: ["kulanz.preview", onlyWithoutEmail],
    queryFn: () => orpc.kulanz.preview({ onlyWithoutEmail }),
  });

  const history = useQuery({
    queryKey: ["kulanz.list"],
    queryFn: () => orpc.kulanz.list(),
  });

  // Default-select everyone when a preview loads; the user can deselect.
  useEffect(() => {
    if (preview.data) setSelected(new Set(preview.data.items.map((i) => i.memberId)));
  }, [preview.data]);

  const generate = useMutation({
    mutationFn: () =>
      orpc.kulanz.generate({
        memberIds: [...selected],
        deadlineDate: deadline.trim() || null,
        waiveReturnFee,
        mitUnterschrift,
      }),
    onSuccess: (r) => {
      triggerDownloadBase64(r.filename, r.base64, "application/pdf");
      toast.success(`${r.docRef} erstellt: ${r.recipientCount} Schreiben.`);
      setConfirmOpen(false);
      qc.invalidateQueries({ queryKey: ["kulanz.list"] });
    },
    onError: (e: Error) => {
      setConfirmOpen(false);
      toast.error("Konnte nicht erstellt werden", { description: e.message });
    },
  });

  const download = useMutation({
    mutationFn: (id: string) => orpc.kulanz.download({ id }),
    onSuccess: (r) => window.open(r.url, "_blank", "noopener"),
    onError: (e: Error) => toast.error("Download fehlgeschlagen", { description: e.message }),
  });

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const filteredTotals = useMemo(() => {
    if (!preview.data) return { count: 0, openSum: "0", feeSum: "0", noAddress: 0 };
    const picked = preview.data.items.filter((i) => selected.has(i.memberId));
    const feeSum = sumDec(picked.map((i) => i.feeSum));
    const gross = sumDec(picked.map((i) => i.openSum));
    return {
      count: picked.length,
      openSum: waiveReturnFee ? sumDec([gross, `-${feeSum}`]) : gross,
      feeSum,
      noAddress: picked.filter((i) => !i.hasAddress).length,
    };
  }, [preview.data, selected, waiveReturnFee]);

  function toggleAll() {
    if (!preview.data) return;
    if (selected.size === preview.data.items.length) setSelected(new Set());
    else setSelected(new Set(preview.data.items.map((i) => i.memberId)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link to="/app/forderungen" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-3" /> Forderungen
          </Link>
        </div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          Zahlungserinnerung mit Sonderkündigung
        </h1>
        <p className="text-sm text-muted-foreground">
          Ein Sammelbrief für Mitglieder mit offenen Beiträgen. Sie können zahlen oder aus Kulanz
          die beigelegte Kündigungsbestätigung zurücksenden. In dem Fall wird auf die offene
          Forderung verzichtet.
        </p>
      </div>

      <InfoBox title="Wie funktioniert dieser Brief?" collapsible defaultOpen={false}>
        <ul className="space-y-1">
          <li>Jedes ausgewählte Mitglied erhält ein eigenes Schreiben in einem gemeinsamen PDF.</li>
          <li>
            Das Schreiben listet die offenen Beiträge, nennt die Bankverbindung und enthält unten
            eine abtrennbare Kündigungsbestätigung zum Unterschreiben.
          </li>
          <li>
            Es werden keine Mahnstufen verändert und keine Posten gebucht. Geht die Zahlung oder die
            Kündigung ein, markieren Sie das wie gewohnt von Hand.
          </li>
          <li>
            Der Standard zeigt nur Mitglieder ohne E-Mail-Adresse, denn für diese ist der Postweg
            gedacht.
          </li>
        </ul>
      </InfoBox>

      <Card>
        <CardHeader>
          <CardTitle>Parameter</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Switch
            id="only-without-email"
            label="Nur Mitglieder ohne E-Mail"
            description="Diese können wir nur per Post erreichen."
            checked={onlyWithoutEmail}
            onChange={(e) => setOnlyWithoutEmail(e.target.checked)}
          />
          <Switch
            id="waive-return-fee"
            label="SEPA-Gebühr erlassen"
            description="Aus Kulanz nur den offenen Beitrag fordern."
            checked={waiveReturnFee}
            onChange={(e) => setWaiveReturnFee(e.target.checked)}
          />
          <Switch
            id="mit-unterschrift"
            label="Unterschrift einbetten"
            description="Hinterlegte Vorstand-Unterschrift einsetzen. Sonst leere Linie zum Unterschreiben."
            checked={mitUnterschrift}
            onChange={(e) => setMitUnterschrift(e.target.checked)}
          />
          <Field label="Frist (Zahlung oder Kündigung)">
            <DateField min={today} value={deadline} onChange={(v) => setDeadline(v)} />
            <span className="text-xs text-muted-foreground">
              Leer lassen, um die Standardfrist aus den Vereinsdaten zu verwenden.
            </span>
          </Field>
        </CardContent>
      </Card>

      {filteredTotals.noAddress > 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            {filteredTotals.noAddress} ausgewählte(s) Mitglied(er) ohne hinterlegte Anschrift. Diese
            Schreiben lassen sich nicht per Post zustellen. Pflegen Sie die Adresse oder wählen Sie
            die Mitglieder ab.
          </span>
        </div>
      ) : null}

      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Empfänger {preview.data ? `(${preview.data.items.length})` : ""}</CardTitle>
          {preview.data && preview.data.items.length > 0 ? (
            <button
              type="button"
              onClick={toggleAll}
              className="text-xs text-muted-foreground hover:underline"
            >
              {selected.size === preview.data.items.length ? "Alle abwählen" : "Alle auswählen"}
            </button>
          ) : null}
        </CardHeader>
        <CardContent>
          {preview.isLoading ? (
            <SkeletonText lines={5} className="max-w-md" />
          ) : preview.isError ? (
            <QueryError onRetry={() => preview.refetch()} />
          ) : !preview.data || preview.data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {onlyWithoutEmail
                ? "Keine Mitglieder mit offenen Beiträgen ohne E-Mail-Adresse. Schalten Sie den Filter oben aus, um alle mit offenen Beiträgen zu sehen."
                : "Keine Mitglieder mit offenen Beiträgen."}
            </p>
          ) : (
            <ul className="divide-y">
              {preview.data.items.map((i) => (
                <li key={i.memberId} className="flex items-start gap-3 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(i.memberId)}
                    onChange={() => toggleOne(i.memberId)}
                    className="mt-1 size-4 rounded border-input"
                    aria-label="Auswählen"
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to="/app/mitglieder/$mitgliedsnummer"
                        params={{ mitgliedsnummer: i.reference }}
                        className="font-medium hover:underline"
                      >
                        {i.name}
                      </Link>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        #{i.reference}
                      </span>
                      {i.isContact ? <Badge variant="outline">Kontakt</Badge> : null}
                      {!i.hasEmail ? (
                        <Badge variant="secondary" className="gap-1">
                          <MailX className="size-3" /> keine E-Mail
                        </Badge>
                      ) : null}
                      {!i.hasAddress ? <Badge variant="warning">Anschrift fehlt</Badge> : null}
                      {i.addressedToGuardian ? <Badge>An Vertretung</Badge> : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {i.postingCount} offene(r) Posten
                    </p>
                  </div>
                  <span className="font-semibold tabular-nums">{formatCurrency(i.openSum)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col items-end gap-4 p-5 sm:flex-row sm:justify-between">
          <div className="flex flex-col gap-1 text-sm">
            <span>
              Ausgewählt: <strong className="tabular-nums">{filteredTotals.count}</strong>
            </span>
            <span>
              Summe offen:{" "}
              <strong className="tabular-nums">{formatCurrency(filteredTotals.openSum)}</strong>
            </span>
            {waiveReturnFee && Number.parseFloat(filteredTotals.feeSum) > 0 ? (
              <span className="text-xs text-muted-foreground">
                Erlassene SEPA-Gebühr:{" "}
                <span className="tabular-nums">{formatCurrency(filteredTotals.feeSum)}</span>
              </span>
            ) : null}
          </div>
          <Button
            disabled={filteredTotals.count === 0 || generate.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            <HeartHandshake className="size-4" />
            Sammelbrief erzeugen ({filteredTotals.count})
          </Button>
        </CardContent>
      </Card>

      {history.data && history.data.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Frühere Sammelbriefe</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {history.data.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex items-center gap-2 font-medium">
                      <FileText className="size-4 text-muted-foreground" />
                      {h.docRef ?? `${h.recipientCount} Schreiben`}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {h.docRef ? `${h.recipientCount} Schreiben · ` : ""}
                      {formatDate(h.runDate)} · Frist {formatDate(h.deadlineDate)} · offen{" "}
                      {formatCurrency(h.totalOpen)}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={download.isPending}
                    onClick={() => download.mutate(h.id)}
                  >
                    <Download className="size-4" />
                    PDF
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(o) => {
          if (!o && !generate.isPending) setConfirmOpen(false);
        }}
        title="Sammelbrief erzeugen"
        description={`${filteredTotals.count} Schreiben mit Kündigungsbestätigung erzeugen?${
          waiveReturnFee ? " Die SEPA-Gebühr wird aus Kulanz erlassen." : ""
        } Es werden keine Mahnstufen verändert.`}
        confirmLabel="Erzeugen"
        loading={generate.isPending}
        onConfirm={() => generate.mutate()}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed in as `children`, so the label wraps and is implicitly associated.
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
