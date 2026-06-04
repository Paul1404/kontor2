import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Input } from "~/components/ui/input";
import { QueryError } from "~/components/ui/query-error";
import { toast } from "~/components/ui/toaster";
import { formatCurrency, formatDate } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/forderungen/mahnungen/neu")({
  component: NewDunningRunPage,
});

const LEVEL_LABELS: Record<number, string> = {
  1: "Erinnerung",
  2: "1. Mahnung",
  3: "2. Mahnung",
};

function NewDunningRunPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [level, setLevel] = useState<1 | 2 | 3>(1);
  const [runDate, setRunDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const preview = useQuery({
    queryKey: ["dunning.preview", level, runDate],
    queryFn: () => orpc.dunning.preview({ level, runDate }),
  });

  // Default-select everyone when the preview loads. The user can still
  // deselect individually before committing.
  useEffect(() => {
    if (preview.data) {
      setSelected(new Set(preview.data.items.map((i) => i.memberId)));
    }
  }, [preview.data]);

  const commit = useMutation({
    mutationFn: () =>
      orpc.dunning.commit({
        level,
        memberIds: [...selected],
        runDate,
        notes: notes.trim() || null,
      }),
    onSuccess: (r) => {
      toast.success(`Mahnlauf erstellt: ${r.itemCount} Mahnung(en) generiert.`);
      qc.invalidateQueries({ queryKey: ["dunning.list"] });
      qc.invalidateQueries({ queryKey: ["dunning.open"] });
      navigate({ to: "/app/forderungen/mahnungen/$id", params: { id: r.runId } });
    },
    onError: (e: Error) => toast.error("Konnte nicht erstellt werden", { description: e.message }),
  });

  const filteredTotals = useMemo(() => {
    if (!preview.data) return { count: 0, openSum: "0", fees: "0", totalDue: "0" };
    const picked = preview.data.items.filter((i) => selected.has(i.memberId));
    return {
      count: picked.length,
      openSum: sumDec(picked.map((i) => i.openSum)),
      fees: sumDec(picked.map((i) => i.mahngebuhr)),
      totalDue: sumDec(picked.map((i) => i.totalDue)),
    };
  }, [preview.data, selected]);

  function toggleAll() {
    if (!preview.data) return;
    if (selected.size === preview.data.items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(preview.data.items.map((i) => i.memberId)));
    }
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
          <Link
            to="/app/forderungen/mahnungen"
            className="inline-flex items-center gap-1 hover:underline"
          >
            <ArrowLeft className="size-3" /> Mahnläufe
          </Link>
        </div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Neuer Mahnlauf</h1>
        <p className="text-sm text-muted-foreground">
          Erstellt PDFs für alle ausgewählten Empfänger und hebt deren Mahnstufe an. Der Versand
          erfolgt danach pro Empfänger per E-Mail oder Brief.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Parameter</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Stufe">
            <select
              value={level}
              onChange={(e) => setLevel(Number.parseInt(e.target.value, 10) as 1 | 2 | 3)}
              className="h-9 rounded-lg border border-input bg-card px-3 text-sm shadow-soft"
            >
              <option value="1">1: Erinnerung</option>
              <option value="2">2: 1. Mahnung</option>
              <option value="3">3: 2. Mahnung</option>
            </select>
          </Field>
          <Field label="Lauf-Datum">
            <Input type="date" value={runDate} onChange={(e) => setRunDate(e.target.value)} />
          </Field>
          <Field label="Frist">
            <Input
              value={preview.data?.dueDate ? formatDate(preview.data.dueDate) : "—"}
              disabled
            />
          </Field>
          <div className="sm:col-span-3">
            <Field label="Notiz">
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="optional, z.B. Hinweis auf Versand"
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      {preview.data && preview.data.blocked.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-warning">
              <ShieldAlert className="size-4" />
              Mahngesperrte Mitglieder (übersprungen)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {preview.data.blocked.map((b) => (
                <li key={b.memberId} className="flex items-center justify-between py-2">
                  <span>
                    {b.name}{" "}
                    <span className="text-xs text-muted-foreground">#{b.mitglnr ?? b.adrNr}</span>
                  </span>
                  <span className="text-sm tabular-nums">{formatCurrency(b.openSum)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {preview.data && preview.data.totals.minorsWithoutGuardian > 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            {preview.data.totals.minorsWithoutGuardian} minderjährige(s) Mitglied(er) ohne
            hinterlegte gesetzliche Vertretung. Die Mahnung würde direkt an das Mitglied gehen.
            Hinterlege eine Vertretung über die Beziehungen oder die Mitglieds-Stammdaten.
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
            <p className="text-sm text-muted-foreground">Wird geladen...</p>
          ) : preview.isError ? (
            <QueryError onRetry={() => preview.refetch()} />
          ) : !preview.data || preview.data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Keine Empfänger für Stufe {level}. Für die nächste Stufe ist erst eine niedrigere
              Mahnung notwendig.
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
                        params={{ mitgliedsnummer: i.mitglnr ?? String(i.adrNr) }}
                        className="font-medium hover:underline"
                      >
                        {i.name}
                      </Link>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        #{i.mitglnr ?? i.adrNr}
                      </span>
                      {!i.hasAddress ? <Badge variant="warning">Anschrift fehlt</Badge> : null}
                      {i.minorWithoutGuardian ? (
                        <Badge variant="warning">Minderjährig ohne Vertretung</Badge>
                      ) : i.guardianSource ? (
                        <Badge
                          className="gap-1"
                          title="Wird an die gesetzliche Vertretung adressiert"
                        >
                          <ShieldCheck className="size-3" /> An Vertretung
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {i.postings.length} offene(r) Posten
                      {i.guardianSource && i.recipientName ? <> · an {i.recipientName}</> : null}
                      {i.eMail ? <> · {i.eMail}</> : null}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <span className="font-semibold tabular-nums">{formatCurrency(i.totalDue)}</span>
                    <span className="text-xs text-muted-foreground">
                      offen {formatCurrency(i.openSum)} · Gebühr {formatCurrency(i.mahngebuhr)}
                    </span>
                  </div>
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
            <span>
              Mahngebühren:{" "}
              <strong className="tabular-nums">{formatCurrency(filteredTotals.fees)}</strong>
            </span>
            <span>
              Insgesamt zu zahlen:{" "}
              <strong className="tabular-nums">{formatCurrency(filteredTotals.totalDue)}</strong>
            </span>
          </div>
          <Button
            disabled={selected.size === 0 || commit.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            {commit.isPending ? "Wird erstellt..." : `${LEVEL_LABELS[level]} erstellen`}
          </Button>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(o) => {
          if (!commit.isPending) setConfirmOpen(o);
        }}
        title={`${LEVEL_LABELS[level]} erstellen`}
        description={`${LEVEL_LABELS[level]} für ${filteredTotals.count} Empfänger erzeugen? Die Mahnstufe der betroffenen Posten wird automatisch erhöht.`}
        confirmLabel={`${LEVEL_LABELS[level]} erstellen`}
        loading={commit.isPending}
        onConfirm={() => commit.mutate()}
      >
        <div className="flex flex-col gap-1 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Empfänger</span>
            <span className="tabular-nums">{filteredTotals.count}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Summe offen</span>
            <span className="tabular-nums">{formatCurrency(filteredTotals.openSum)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Mahngebühren</span>
            <span className="tabular-nums">{formatCurrency(filteredTotals.fees)}</span>
          </div>
          <div className="flex justify-between font-medium">
            <span>Insgesamt zu zahlen</span>
            <span className="tabular-nums">{formatCurrency(filteredTotals.totalDue)}</span>
          </div>
        </div>
      </ConfirmDialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed in as `children`, so the label wraps and is implicitly associated.
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function sumDec(values: string[]): string {
  let c = 0;
  for (const v of values) c += Math.round(Number.parseFloat(v) * 100);
  return (c / 100).toFixed(2);
}
