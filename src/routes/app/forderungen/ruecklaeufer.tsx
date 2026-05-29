import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Plus, Search, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { toast } from "~/components/ui/toaster";
import { formatCurrency, formatDate } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/forderungen/ruecklaeufer")({
  component: RuecklaeuferPage,
});

const REASON_OPTIONS = [
  { code: "AM04", label: "AM04 – Konto ohne Deckung" },
  { code: "MD06", label: "MD06 – Erstattung vom Schuldner verlangt" },
  { code: "AC04", label: "AC04 – Konto geschlossen" },
  { code: "AC06", label: "AC06 – Konto gesperrt" },
  { code: "MS02", label: "MS02 – Widerspruch durch Schuldner" },
  { code: "MS03", label: "MS03 – kein Grund angegeben" },
  { code: "MD01", label: "MD01 – kein gültiges Mandat" },
  { code: "RR01", label: "RR01 – Name/Anschrift fehlt" },
];

function RuecklaeuferPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const list = useQuery({
    queryKey: ["sepaReturns.list"],
    queryFn: () => orpc.sepaReturns.list({ page: 1, pageSize: 100 }),
  });

  const deleteOne = useMutation({
    mutationFn: (id: string) => orpc.sepaReturns.delete({ id }),
    onSuccess: () => {
      toast.success("Rückläufer entfernt.");
      qc.invalidateQueries({ queryKey: ["sepaReturns.list"] });
      qc.invalidateQueries({ queryKey: ["dunning.open"] });
    },
    onError: (e: Error) => toast.error("Konnte nicht entfernt werden", { description: e.message }),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link to="/app/forderungen" className="inline-flex items-center gap-1 hover:underline">
              <ArrowLeft className="size-3" /> Forderungen
            </Link>
          </div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">SEPA-Rückläufer</h1>
          <p className="text-sm text-muted-foreground">
            Erfasste R-Transaktionen aus den Beitragsläufen. Eine erfasste Lastschrift wird auf die
            Sollstellung zurückgeschrieben.
          </p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)} variant={showForm ? "outline" : "default"}>
          {showForm ? (
            <>
              <X className="size-4" /> Abbrechen
            </>
          ) : (
            <>
              <Plus className="size-4" /> Rückläufer erfassen
            </>
          )}
        </Button>
      </div>

      {showForm ? <CreateForm onDone={() => setShowForm(false)} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Bisherige Rückläufer</CardTitle>
        </CardHeader>
        <CardContent>
          {list.isLoading ? (
            <p className="text-sm text-muted-foreground">Wird geladen...</p>
          ) : !list.data || list.data.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Bisher keine Rückläufer erfasst.</p>
          ) : (
            <ul className="divide-y">
              {list.data.rows.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-4 py-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to="/app/mitglieder/$mitgliedsnummer"
                        params={{ mitgliedsnummer: r.mitglnr ?? String(r.adrNr) }}
                        className="font-medium hover:underline"
                      >
                        {r.memberName}
                      </Link>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        #{r.mitglnr ?? r.adrNr}
                      </span>
                      {r.reasonCode ? <Badge variant="warning">{r.reasonCode}</Badge> : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Beitragsjahr {r.billingYear} · zurückgegeben {formatDate(r.returnedOn)} ·
                      ursprünglich {formatCurrency(r.amount)}
                      {Number(r.rueckgebuhr) > 0 ? (
                        <> · R-Gebühr {formatCurrency(r.rueckgebuhr)}</>
                      ) : null}
                    </p>
                    {r.reasonText ? (
                      <p className="text-xs text-muted-foreground">{r.reasonText}</p>
                    ) : null}
                    {r.notes ? <p className="text-xs text-muted-foreground">{r.notes}</p> : null}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (confirm("Diesen Rückläufer wirklich entfernen?")) deleteOne.mutate(r.id);
                    }}
                    disabled={deleteOne.isPending}
                    title="Rückläufer rückgängig machen"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{ id: string; label: string } | null>(null);
  const [returnedOn, setReturnedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [reasonCode, setReasonCode] = useState<string>("");
  const [reasonText, setReasonText] = useState("");
  const [rueckgebuhr, setRueckgebuhr] = useState("");
  const [notes, setNotes] = useState("");

  const candidates = useQuery({
    queryKey: ["sepaReturns.candidates", query],
    queryFn: () => orpc.sepaReturns.candidates({ query, limit: 30 }),
  });

  const create = useMutation({
    mutationFn: () =>
      orpc.sepaReturns.create({
        feeRunItemId: selected!.id,
        returnedOn,
        reasonCode: reasonCode ? (reasonCode as "AM04") : null,
        reasonText: reasonText.trim() || null,
        rueckgebuhr: rueckgebuhr.trim() || "0",
        notes: notes.trim() || null,
      }),
    onSuccess: () => {
      toast.success("Rückläufer erfasst.");
      qc.invalidateQueries({ queryKey: ["sepaReturns.list"] });
      qc.invalidateQueries({ queryKey: ["sepaReturns.candidates"] });
      qc.invalidateQueries({ queryKey: ["dunning.open"] });
      onDone();
    },
    onError: (e: Error) => toast.error("Konnte nicht erfasst werden", { description: e.message }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rückläufer erfassen</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Lastschrift
          </span>
          {selected ? (
            <div className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
              <span>{selected.label}</span>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                Ändern
              </Button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Mitgliedsnummer, Name oder End-to-End-ID"
                  className="pl-8"
                />
              </div>
              <div className="max-h-72 overflow-y-auto rounded-lg border">
                {candidates.isLoading ? (
                  <p className="p-3 text-sm text-muted-foreground">Wird geladen...</p>
                ) : !candidates.data || candidates.data.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">Keine offenen Lastschriften.</p>
                ) : (
                  <ul className="divide-y">
                    {candidates.data.map((c) => (
                      <li key={c.itemId}>
                        <button
                          type="button"
                          className="w-full cursor-pointer p-3 text-left text-sm hover:bg-accent"
                          onClick={() =>
                            setSelected({
                              id: c.itemId,
                              label: `${c.memberName} · ${c.billingYear} · ${formatCurrency(c.amount)} · ${c.sequenceType} · ****${c.debtorIbanLast4}`,
                            })
                          }
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{c.memberName}</span>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              #{c.mitglnr ?? c.adrNr}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Beitragsjahr {c.billingYear} · {c.sequenceType} ·{" "}
                            {formatCurrency(c.amount)} · IBAN ****{c.debtorIbanLast4}
                          </p>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Datum Rückgabe">
            <Input type="date" value={returnedOn} onChange={(e) => setReturnedOn(e.target.value)} />
          </Field>
          <Field label="R-Transaction-Code">
            <select
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
              className="h-9 rounded-lg border border-input bg-card px-3 text-sm shadow-soft"
            >
              <option value="">(kein Code)</option>
              {REASON_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Begründung (frei)">
            <Input
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              placeholder="optional"
            />
          </Field>
          <Field label="Rücklastgebühr in €">
            <Input
              value={rueckgebuhr}
              onChange={(e) => setRueckgebuhr(e.target.value.replace(",", "."))}
              placeholder="z.B. 3,00"
              inputMode="decimal"
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notizen">
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="optional"
              />
            </Field>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onDone}>
            Abbrechen
          </Button>
          <Button disabled={!selected || create.isPending} onClick={() => create.mutate()}>
            Erfassen
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}
