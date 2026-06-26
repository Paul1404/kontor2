import { useMutation } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  Info,
  Loader2,
  ShieldCheck,
  Upload,
  XCircle,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { InfoBox } from "~/components/ui/info-box";
import { Textarea } from "~/components/ui/textarea";
import { EMPTY_VALUE } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/admin/sepa-pruefung")({
  beforeLoad: async () => {
    let me: Awaited<ReturnType<typeof orpc.auth.me>>;
    try {
      me = await orpc.auth.me();
    } catch {
      throw redirect({ to: "/login" });
    }
    if (me.role !== "admin") throw redirect({ to: "/app" });
  },
  component: SepaPruefungPage,
});

type Result = Awaited<ReturnType<typeof orpc.sepaTools.validateXml>>;

const eur = (s: string) => `${s} €`;

const SEQ_LABEL: Record<string, string> = {
  FRST: "Erstlastschrift",
  RCUR: "Folgelastschrift",
  OOFF: "Einmallastschrift",
  FNAL: "Letzte Lastschrift",
};
const seqLabel = (code: string) => SEQ_LABEL[code] ?? code;

function SepaPruefungPage() {
  const [xml, setXml] = useState("");
  const [filename, setFilename] = useState<string | null>(null);

  const validate = useMutation({
    mutationFn: () => orpc.sepaTools.validateXml({ xml, filename }),
  });
  const res = validate.data;

  const onFile = (file: File | undefined) => {
    if (!file) return;
    setFilename(file.name);
    const fr = new FileReader();
    fr.onload = () => setXml(typeof fr.result === "string" ? fr.result : "");
    fr.readAsText(file);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-brand-accent" />
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">SEPA-Prüfstand</h1>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          pain.008-Lastschriftdatei einlesen und gründlich prüfen, was wirklich passiert: Summen,
          IBAN-, BIC- und Gläubiger-ID-Prüfziffern, Mandatsdaten, Fälligkeit und Zeichensatz, nach
          deutschem SEPA-Standard. Es wird nichts gespeichert oder eingezogen, reine Analyse.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Datei einlesen</CardTitle>
          <CardDescription>XML einfügen oder eine .xml-Datei laden.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Textarea
            value={xml}
            onChange={(e) => {
              setXml(e.target.value);
              setFilename(null);
            }}
            rows={8}
            placeholder="<?xml version=…> … pain.008 …"
            className="font-mono text-xs"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={!xml.trim() || validate.isPending}
              onClick={() => validate.mutate()}
            >
              {validate.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileCheck2 className="size-4" />
              )}
              Prüfen
            </Button>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-card px-3 py-2 text-sm shadow-soft hover:bg-muted/40">
              <Upload className="size-4" />
              Datei wählen
              <input
                type="file"
                accept=".xml,text/xml,application/xml"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </label>
            {filename ? <span className="text-xs text-muted-foreground">{filename}</span> : null}
          </div>
          {validate.isError ? (
            <p className="text-sm text-destructive">
              {(validate.error as Error).message || "Prüfung fehlgeschlagen."}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {res ? <ResultView res={res} /> : null}

      <Glossar />
    </div>
  );
}

function GlossarRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-[12rem_1fr] sm:gap-3">
      <dt className="font-mono text-xs font-medium text-foreground">{term}</dt>
      <dd className="text-sm text-muted-foreground">{children}</dd>
    </div>
  );
}

function Glossar() {
  return (
    <InfoBox title="Was bedeuten die Felder? (Glossar)" collapsible defaultOpen={false}>
      <dl className="flex flex-col gap-2">
        <GlossarRow term="Sequenz">
          Art der Lastschrift je Mandat. <strong>FRST</strong> = Erstlastschrift (erste Nutzung
          eines Mandats), <strong>RCUR</strong> = Folgelastschrift (jede weitere),{" "}
          <strong>OOFF</strong> = Einmallastschrift (einmalig), <strong>FNAL</strong> = letzte
          Lastschrift. Seit 2016 darf auch die erste Abbuchung als RCUR laufen, deutsche Banken
          akzeptieren das.
        </GlossarRow>
        <GlossarRow term="Fälligkeit">
          Tag, an dem die Bank das Geld tatsächlich von den Konten einzieht (ReqdColltnDt). Muss ein
          Bankarbeitstag sein und etwas Vorlauf haben.
        </GlossarRow>
        <GlossarRow term="Nachrichten-ID">
          Eindeutige Kennung der Datei (MsgId). Die Bank erkennt daran eine doppelt eingereichte
          Datei.
        </GlossarRow>
        <GlossarRow term="Gläubiger-ID">
          Die Gläubiger-Identifikationsnummer des Vereins (CdtrSchmeId), z. B. DE71ZZZ…. Sie weist
          den Verein als berechtigten Einreicher aus, geprüft per Prüfziffer.
        </GlossarRow>
        <GlossarRow term="Mandat">
          Mandatsreferenz (MndtId): die eindeutige Nummer der Einzugsermächtigung, die das Mitglied
          unterschrieben hat.
        </GlossarRow>
        <GlossarRow term="Mandatsdatum">
          Datum, an dem das SEPA-Mandat unterschrieben wurde (DtOfSgntr). Muss in der Vergangenheit
          liegen.
        </GlossarRow>
        <GlossarRow term="IBAN / BIC">
          Konto und Bank des Zahlungspflichtigen. Bei deutschen IBANs ist die BIC optional
          („IBAN-only", in der Datei NOTPROVIDED), die Bank leitet sie aus der IBAN ab.
        </GlossarRow>
        <GlossarRow term="CORE / SEPA">
          CORE = SEPA-Basislastschrift (für Privatpersonen), SvcLvl SEPA = Standard-SEPA-Verfahren.
          B2B wäre die Firmenlastschrift.
        </GlossarRow>
        <GlossarRow term="Betrag / Summe">
          Einzelbetrag je Posten und die Kontrollsumme (CtrlSum). Der Prüfstand rechnet nach, ob die
          deklarierte Summe und Anzahl zu den tatsächlichen Posten passen.
        </GlossarRow>
        <GlossarRow term="Befunde">
          <span className="text-destructive">Fehler</span> verhindern die Einreichung,{" "}
          <span className="text-warning">Warnungen</span> solltest du prüfen,{" "}
          <span className="text-muted-foreground">Hinweise</span> sind nur zur Information.
        </GlossarRow>
      </dl>
    </InfoBox>
  );
}

function ResultView({ res }: { res: Result }) {
  return (
    <div className="flex flex-col gap-5">
      <div
        className={`flex items-center gap-3 rounded-xl border p-4 ${
          res.ok ? "border-success/40 bg-success/10" : "border-destructive/40 bg-destructive/10"
        }`}
      >
        {res.ok ? (
          <CheckCircle2 className="size-6 text-success" />
        ) : (
          <XCircle className="size-6 text-destructive" />
        )}
        <div className="flex flex-col">
          <span className="font-semibold">
            {res.ok ? "Keine Fehler gefunden, einreichbar" : `${res.counts.errors} Fehler gefunden`}
          </span>
          <span className="text-xs text-muted-foreground">
            {res.counts.warnings} Warnungen · {res.counts.infos} Hinweise · Format{" "}
            {res.format ?? EMPTY_VALUE}
            {res.filename ? ` · ${res.filename}` : ""}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Posten"
          value={`${res.summary.computedCount} (deklariert ${res.summary.declaredCount})`}
        />
        <Stat
          label="Summe"
          value={`${eur(res.summary.computedSum)} (deklariert ${eur(res.summary.declaredSum)})`}
        />
        <Stat label="Fälligkeit" value={res.summary.collectionDates.join(", ") || EMPTY_VALUE} />
        <Stat
          label="Sequenzen"
          value={
            Object.entries(res.summary.bySequence)
              .map(([k, v]) => `${seqLabel(k)} (${k}): ${v.count}/${eur(v.sum)}`)
              .join(" · ") || EMPTY_VALUE
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Gläubiger und Kopf</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Field label="Nachrichten-ID" value={res.summary.messageId} mono />
          <Field label="Erstellt" value={res.summary.creationDateTime} />
          <Field label="Gläubiger" value={res.summary.creditorName} />
          <Field label="Gläubiger-ID" value={res.summary.creditorId} mono />
          <Field label="Gläubiger-IBAN" value={res.summary.creditorIban} mono />
          <Field label="Gläubiger-BIC" value={res.summary.creditorBic ?? EMPTY_VALUE} mono />
        </CardContent>
      </Card>

      {res.findings.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Befunde ({res.findings.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col divide-y divide-border">
            {res.findings.map((f, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: findings are a static, non-reordered list
              <div key={`${f.code}-${i}`} className="flex items-start gap-2 py-2 text-sm">
                {f.severity === "error" ? (
                  <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                ) : f.severity === "warning" ? (
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                ) : (
                  <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                )}
                <div className="flex min-w-0 flex-col">
                  <span>{f.message}</span>
                  {f.where ? (
                    <span className="text-xs text-muted-foreground">{f.where}</span>
                  ) : null}
                </div>
                <Badge variant="outline" className="ml-auto shrink-0 font-mono text-[10px]">
                  {f.code}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Posten ({res.transactions.length})</CardTitle>
          <CardDescription>Genau das würde abgebucht.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b border-border">
                <th className="py-2 pr-3">Zahlungspflichtiger</th>
                <th className="py-2 pr-3">IBAN</th>
                <th className="py-2 pr-3">Mandat</th>
                <th className="py-2 pr-3">Mandatsdatum</th>
                <th className="py-2 pr-3">Seq</th>
                <th className="py-2 pr-3 text-right">Betrag</th>
              </tr>
            </thead>
            <tbody>
              {res.transactions.map((t) => (
                <tr key={t.endToEndId} className="border-b border-border/60">
                  <td className="py-2 pr-3 font-medium">{t.debtorName || EMPTY_VALUE}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{t.debtorIban || EMPTY_VALUE}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{t.mandateId || EMPTY_VALUE}</td>
                  <td className="py-2 pr-3 tabular-nums">{t.signatureDate || EMPTY_VALUE}</td>
                  <td className="py-2 pr-3">
                    {t.sequenceType}
                    <div className="text-xs text-muted-foreground">{seqLabel(t.sequenceType)}</div>
                  </td>
                  <td className="py-2 pr-3 text-right font-medium tabular-nums">{eur(t.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-soft">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-semibold">{value}</div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-xs break-all" : ""}>{value || EMPTY_VALUE}</span>
    </div>
  );
}
