import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Download,
  Loader2,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { QueryError } from "~/components/ui/query-error";
import { triggerDownload } from "~/lib/download";
import { EMPTY_VALUE, formatCurrency } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/beitrag/neu")({
  component: NewFeeRunPage,
});

type Step = "setup" | "preview" | "done";

function NewFeeRunPage() {
  const nav = useNavigate();
  const org = useQuery({
    queryKey: ["organization"],
    queryFn: () => orpc.organization.get(),
  });

  const [step, setStep] = useState<Step>("setup");
  const today = new Date();
  const [billingYear, setBillingYear] = useState(today.getFullYear());
  const [falligkeitsdatum, setFalligkeitsdatum] = useState(() => {
    const y = today.getFullYear();
    const tag = 15;
    return `${y}-02-${tag.toString().padStart(2, "0")}`;
  });
  const [mandateOverrides, setMandateOverrides] = useState<Record<string, string>>({});
  const [done, setDone] = useState<{
    feeRunId: string;
    itemCount: number;
    totalAmount: string;
    xmlFilename: string;
  } | null>(null);

  const previewQuery = useQuery({
    enabled: step === "preview",
    queryKey: ["feeRuns.preview", billingYear, falligkeitsdatum, mandateOverrides],
    queryFn: () =>
      orpc.feeRuns.preview({
        billingYear,
        falligkeitsdatum,
        mandateOverrides,
      }),
  });

  const commit = useMutation({
    mutationFn: () => {
      if (!previewQuery.data) throw new Error("Preview missing");
      return orpc.feeRuns.commit({
        billingYear,
        falligkeitsdatum,
        mandateOverrides,
        expectedTotalAmount: previewQuery.data.totals.grandTotal,
        expectedItemCount: previewQuery.data.totals.count,
        notes: null,
      });
    },
    onSuccess: (data) => {
      setDone(data);
      setStep("done");
    },
  });

  if (!org.data && !org.isLoading) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 p-6">
          <div className="flex items-center gap-2 text-warning">
            <AlertTriangle className="size-5" />
            <span className="font-medium">Vereinsdaten fehlen</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Bevor ein Beitragslauf erzeugt werden kann, müssen Gläubiger-ID, Vereins-IBAN und BIC
            gepflegt sein.
          </p>
          <Link to="/app/einstellungen/verein">
            <Button>Zu den Vereinsdaten</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => nav({ to: "/app/beitrag" })}
          className="self-start text-xs text-muted-foreground hover:text-foreground"
        >
          ← Zurück zur Übersicht
        </button>
        <h1 className="text-2xl font-semibold tracking-tight">Neuer Beitragslauf</h1>
      </div>

      <StepBar step={step} />

      {step === "setup" ? (
        <SetupStep
          billingYear={billingYear}
          setBillingYear={setBillingYear}
          falligkeitsdatum={falligkeitsdatum}
          setFalligkeitsdatum={setFalligkeitsdatum}
          onNext={() => setStep("preview")}
        />
      ) : null}

      {step === "preview" ? (
        <PreviewStep
          preview={previewQuery.data}
          isLoading={previewQuery.isLoading}
          isFetching={previewQuery.isFetching}
          isError={previewQuery.isError}
          error={previewQuery.error}
          onRetry={() => previewQuery.refetch()}
          billingYear={billingYear}
          falligkeitsdatum={falligkeitsdatum}
          mandateOverrides={mandateOverrides}
          setMandateOverrides={setMandateOverrides}
          onBack={() => setStep("setup")}
          onCommit={() => commit.mutate()}
          commitPending={commit.isPending}
          commitError={(commit.error as Error | null)?.message ?? null}
        />
      ) : null}

      {step === "done" && done ? <DoneStep result={done} /> : null}
    </div>
  );
}

function StepBar({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: "setup", label: "1. Zeitraum" },
    { id: "preview", label: "2. Vorschau" },
    { id: "done", label: "3. Erzeugt" },
  ];
  const activeIdx = steps.findIndex((s) => s.id === step);
  return (
    <div className="flex items-center gap-2 text-xs">
      {steps.map((s, i) => (
        <div key={s.id} className="flex items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 ${
              i === activeIdx
                ? "bg-brand text-brand-foreground"
                : i < activeIdx
                  ? "bg-muted text-foreground"
                  : "bg-muted/50 text-muted-foreground"
            }`}
          >
            {s.label}
          </span>
          {i < steps.length - 1 ? <ChevronRight className="size-3 text-muted-foreground" /> : null}
        </div>
      ))}
    </div>
  );
}

function SetupStep(props: {
  billingYear: number;
  setBillingYear: (n: number) => void;
  falligkeitsdatum: string;
  setFalligkeitsdatum: (s: string) => void;
  onNext: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Abrechnungsjahr und Fälligkeit</CardTitle>
        <CardDescription>Welches Beitragsjahr soll abgebucht werden und wann?</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Label className="flex flex-col gap-1.5">
            <span>Beitragsjahr</span>
            <Input
              type="number"
              min={2000}
              max={2100}
              value={props.billingYear}
              onChange={(e) => props.setBillingYear(Number(e.target.value) || props.billingYear)}
            />
          </Label>
          <Label className="flex flex-col gap-1.5">
            <span>Fälligkeitsdatum</span>
            <Input
              type="date"
              value={props.falligkeitsdatum}
              onChange={(e) => props.setFalligkeitsdatum(e.target.value)}
            />
            <span className="text-xs font-normal text-muted-foreground">
              Datum, zu dem die Bank die Lastschrift einreichen soll.
            </span>
          </Label>
        </div>
        <div className="mt-6 flex justify-end">
          <Button onClick={props.onNext}>
            Vorschau erstellen <ChevronRight className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

type PreviewData = Awaited<ReturnType<typeof orpc.feeRuns.preview>>;

function SimulationSection(props: {
  billingYear: number;
  falligkeitsdatum: string;
  mandateOverrides: Record<string, string>;
}) {
  const [show, setShow] = useState(false);
  const sim = useQuery({
    enabled: show,
    queryKey: [
      "feeRuns.simulate",
      props.billingYear,
      props.falligkeitsdatum,
      props.mandateOverrides,
    ],
    queryFn: () =>
      orpc.feeRuns.simulate({
        billingYear: props.billingYear,
        falligkeitsdatum: props.falligkeitsdatum,
        mandateOverrides: props.mandateOverrides,
      }),
  });

  if (!show) {
    return (
      <Button type="button" variant="outline" onClick={() => setShow(true)}>
        Vorjahresvergleich anzeigen
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Vorjahresvergleich</CardTitle>
        <CardDescription>
          Was dieser Lauf gegenüber dem Vorjahr verändert (je Vertrag).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sim.isLoading || !sim.data ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Berechne Vergleich…
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <SummaryTile
                label={`${sim.data.lastYear.year}`}
                value={formatCurrency(sim.data.lastYear.total)}
              />
              <SummaryTile
                label={`${props.billingYear}`}
                value={formatCurrency(sim.data.thisYear.total)}
                highlight
              />
              <SummaryTile label="Neu" value={`+${sim.data.added.length}`} />
              <SummaryTile label="Entfallen" value={`-${sim.data.removed.length}`} />
            </div>
            <div className="text-sm text-muted-foreground">
              {sim.data.unchangedCount} unverändert · {sim.data.changed.length} mit geändertem
              Betrag
            </div>
            <SimList title="Neu in diesem Lauf" rows={sim.data.added} tone="text-emerald-600" />
            <SimList
              title="Entfallen gegenüber Vorjahr"
              rows={sim.data.removed}
              tone="text-rose-600"
            />
            {sim.data.changed.length > 0 ? (
              <div className="flex flex-col gap-1">
                <div className="text-xs font-semibold uppercase tracking-wide text-amber-600">
                  Betrag geändert ({sim.data.changed.length})
                </div>
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {sim.data.changed.map((c) => (
                    <li
                      key={`${c.name}-${c.to}`}
                      className="flex items-center justify-between py-1.5"
                    >
                      <span>{c.name}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatCurrency(c.from)} → {formatCurrency(c.to)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SimList({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: { name: string; amount: string }[];
  tone: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className={`text-xs font-semibold uppercase tracking-wide ${tone}`}>
        {title} ({rows.length})
      </div>
      <ul className="flex flex-col divide-y divide-border text-sm">
        {rows.slice(0, 100).map((r) => (
          <li key={`${r.name}-${r.amount}`} className="flex items-center justify-between py-1.5">
            <span>{r.name}</span>
            <span className="tabular-nums text-muted-foreground">{formatCurrency(r.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PreviewStep(props: {
  preview: PreviewData | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  billingYear: number;
  falligkeitsdatum: string;
  mandateOverrides: Record<string, string>;
  setMandateOverrides: (m: Record<string, string>) => void;
  onBack: () => void;
  onCommit: () => void;
  commitPending: boolean;
  commitError: string | null;
}) {
  if (props.isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 p-10">
          <QueryError
            title="Vorschau fehlgeschlagen"
            description="Der Beitragslauf konnte nicht berechnet werden."
            error={props.error}
            onRetry={props.onRetry}
          />
          <Button type="button" variant="outline" onClick={props.onBack}>
            Zurück
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (props.isLoading || !props.preview) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-2 p-12 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" /> Berechne Vorschau...
        </CardContent>
      </Card>
    );
  }

  const p = props.preview;
  const hasIssues = p.issues.some((i) => i.level === "error");

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SummaryTile label="Posten" value={p.totals.count.toString()} />
        <SummaryTile label="Summe" value={formatCurrency(p.totals.grandTotal)} highlight />
        <SummaryTile label="Ausgeschlossen" value={p.excluded.length.toString()} />
      </div>

      <SimulationSection
        billingYear={props.billingYear}
        falligkeitsdatum={props.falligkeitsdatum}
        mandateOverrides={props.mandateOverrides}
      />

      {Object.keys(p.totals.byCategory).length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nach Beitragstyp</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Object.entries(p.totals.byCategory).map(([name, val]) => (
                <div
                  key={name}
                  className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-sm"
                >
                  <span className="font-medium">{name}</span>
                  <span className="text-muted-foreground">
                    {val.count} × · {formatCurrency(val.amount)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {p.conflicts.length > 0 ? (
        <ConflictResolver
          conflicts={p.conflicts}
          candidates={p.candidates}
          overrides={props.mandateOverrides}
          setOverrides={props.setMandateOverrides}
        />
      ) : null}

      {p.excluded.length > 0 ? <ExcludedList excluded={p.excluded} /> : null}

      <IncludedTable candidates={p.candidates} />

      {props.commitError ? (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
          <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span className="flex-1">{props.commitError}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap justify-between gap-3 border-t border-border pt-4">
        <Button variant="outline" onClick={props.onBack} disabled={props.commitPending}>
          <ArrowLeft className="size-4" /> Zurück
        </Button>
        <Button
          onClick={props.onCommit}
          disabled={props.commitPending || hasIssues || p.candidates.length === 0}
        >
          {props.commitPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <CheckCircle2 className="size-4" />
          )}
          Lauf erzeugen ({formatCurrency(p.totals.grandTotal)})
        </Button>
      </div>
    </>
  );
}

function SummaryTile(props: { label: string; value: string; highlight?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{props.label}</div>
        <div
          className={`mt-1 text-2xl font-semibold tabular-nums ${
            props.highlight ? "text-brand" : ""
          }`}
        >
          {props.value}
        </div>
      </CardContent>
    </Card>
  );
}

function ConflictResolver(props: {
  conflicts: PreviewData["conflicts"];
  candidates: PreviewData["candidates"];
  overrides: Record<string, string>;
  setOverrides: (m: Record<string, string>) => void;
}) {
  const memberById = new Map(props.candidates.map((c) => [c.memberId, c]));
  return (
    <Card className="border-warning/40 bg-warning/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-warning-foreground">
          <AlertTriangle className="size-4 text-warning" /> Mehrfach-Mandate (
          {props.conflicts.length})
        </CardTitle>
        <CardDescription>
          Diese Mitglieder haben mehr als ein aktives SEPA-Mandat. Bitte wählen Sie, welches
          verwendet werden soll.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          {props.conflicts.map((conf) => {
            const cand = memberById.get(conf.memberId);
            const chosen = props.overrides[conf.contractId] ?? cand?.chosenMandateId ?? "";
            return (
              <div
                key={`${conf.memberId}-${conf.contractId}`}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background p-3"
              >
                <div className="min-w-40 flex-1">
                  <div className="text-sm font-medium">{cand?.memberName ?? conf.memberId}</div>
                  <div className="text-xs text-muted-foreground">
                    {cand?.artName ?? `Art ${cand?.art ?? ""}`}
                  </div>
                </div>
                <select
                  className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                  value={chosen}
                  onChange={(e) =>
                    props.setOverrides({
                      ...props.overrides,
                      [conf.contractId]: e.target.value,
                    })
                  }
                >
                  {conf.options.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.mandatsNr}
                      {opt.unterschriftDatum ? ` · unterzeichnet ${opt.unterschriftDatum}` : ""}
                      {opt.letzteVerwendung ? ` · zuletzt ${opt.letzteVerwendung}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function ExcludedList(props: { excluded: PreviewData["excluded"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base text-muted-foreground">
          Ausgeschlossen ({props.excluded.length})
        </CardTitle>
        <CardDescription>
          Diese Verträge werden nicht abgerechnet. Nur zur Information.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-sm">
            <tbody>
              {props.excluded.map((e) => (
                <tr key={`${e.memberId}-${e.contractId}`} className="border-b border-border">
                  <td className="px-4 py-2 font-medium">{e.memberName}</td>
                  <td className="px-4 py-2 text-muted-foreground">{e.artName || EMPTY_VALUE}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{e.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function IncludedTable(props: { candidates: PreviewData["candidates"] }) {
  const sorted = useMemo(
    () => [...props.candidates].sort((a, b) => a.memberName.localeCompare(b.memberName, "de")),
    [props.candidates],
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Eingeschlossen ({sorted.length})</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-medium">Mitglied</th>
                <th className="px-4 py-3 font-medium">Art</th>
                <th className="px-4 py-3 text-right font-medium">Betrag</th>
                <th className="px-4 py-3 font-medium">Mandat</th>
                <th className="px-4 py-3 font-medium">SeqTp</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => {
                const chosen = c.mandateOptions.find((o) => o.id === c.chosenMandateId);
                return (
                  <tr key={c.contractId} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-2">
                      <div className="font-medium">{c.memberName}</div>
                      {c.warnings.length > 0 ? (
                        <div className="text-xs text-warning">{c.warnings.join(" · ")}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {c.artName ?? `Art ${c.art}`}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatCurrency(c.amount)}
                      {c.prorationLabel ? (
                        <div className="text-xs text-muted-foreground">
                          anteilig: {c.prorationLabel}
                        </div>
                      ) : null}
                      {c.includesAufnahmegebuhr ? (
                        <div className="text-xs text-muted-foreground">inkl. Aufnahmegebühr</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {chosen?.mandatsNr ?? EMPTY_VALUE}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant="secondary">{c.sequenceType}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function DoneStep({
  result,
}: {
  result: { feeRunId: string; itemCount: number; totalAmount: string; xmlFilename: string };
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 p-12 text-center">
        <CheckCircle2 className="size-12 text-success" />
        <div>
          <div className="text-lg font-semibold">Beitragslauf erzeugt</div>
          <div className="text-sm text-muted-foreground">
            {result.itemCount} Posten · {formatCurrency(result.totalAmount)}
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={async () => {
              const res = await orpc.feeRuns.downloadXml({ id: result.feeRunId });
              triggerDownload(res.filename ?? result.xmlFilename, res.content, "application/xml");
            }}
          >
            <Download className="size-4" /> pain.008 herunterladen
          </Button>
          <Link to="/app/beitrag/$id" params={{ id: result.feeRunId }}>
            <Button variant="outline">Zum Lauf</Button>
          </Link>
          <Link to="/app/beitrag">
            <Button variant="ghost">Übersicht</Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
