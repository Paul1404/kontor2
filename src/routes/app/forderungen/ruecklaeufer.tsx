import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  CheckCircle2,
  FileUp,
  Loader2,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { DateField } from "~/components/ui/date-field";
import { Input } from "~/components/ui/input";
import { QueryError } from "~/components/ui/query-error";
import { SkeletonText } from "~/components/ui/skeleton";
import { toast } from "~/components/ui/toaster";
import { formatCurrency, formatDate } from "~/lib/format";
import { memberRef } from "~/lib/member-ref";
import { orpc } from "~/lib/orpc";
import { SEPA_RETURN_REASON_OPTIONS, sepaReturnReasonLabel } from "~/lib/sepa-reason";

export const Route = createFileRoute("/app/forderungen/ruecklaeufer")({
  component: RuecklaeuferPage,
});

function RuecklaeuferPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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
        <div className="flex flex-wrap gap-2">
          <Button
            variant={showImport ? "default" : "outline"}
            onClick={() => {
              setShowImport((v) => !v);
              setShowForm(false);
            }}
          >
            <FileUp className="size-4" /> camt.054 importieren
          </Button>
          <Button
            onClick={() => {
              setShowForm((v) => !v);
              setShowImport(false);
            }}
            variant={showForm ? "outline" : "default"}
          >
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
      </div>

      {showImport ? <CamtImport onDone={() => setShowImport(false)} /> : null}
      {showForm ? <CreateForm onDone={() => setShowForm(false)} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Bisherige Rückläufer</CardTitle>
        </CardHeader>
        <CardContent>
          {list.isLoading ? (
            <SkeletonText lines={5} className="max-w-md" />
          ) : list.isError ? (
            <QueryError onRetry={() => list.refetch()} />
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
                        params={{ mitgliedsnummer: memberRef(r) }}
                        className="font-medium hover:underline"
                      >
                        {r.memberName}
                      </Link>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        #{memberRef(r)}
                      </span>
                      {r.reasonCode ? (
                        <Badge
                          variant="warning"
                          title={sepaReturnReasonLabel(r.reasonCode) ?? undefined}
                        >
                          {r.reasonCode}
                        </Badge>
                      ) : null}
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
                    onClick={() => setConfirmDeleteId(r.id)}
                    disabled={deleteOne.isPending}
                    aria-label="Rückläufer rückgängig machen"
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

      <ConfirmDialog
        open={confirmDeleteId !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmDeleteId(null);
        }}
        title="Rückläufer entfernen?"
        description="Die Sollstellung wird auf den eingezogenen Stand zurückgesetzt."
        confirmLabel="Entfernen"
        destructive
        loading={deleteOne.isPending}
        onConfirm={() => {
          if (!confirmDeleteId) return;
          deleteOne.mutate(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
      />
    </div>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{
    kind: "item" | "posting";
    id: string;
    label: string;
  } | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [returnedOn, setReturnedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [reasonCode, setReasonCode] = useState<string>("");
  const [reasonText, setReasonText] = useState("");
  const [rueckgebuhr, setRueckgebuhr] = useState("");
  const [notes, setNotes] = useState("");

  const candidates = useQuery({
    queryKey: ["sepaReturns.candidates", query],
    queryFn: () => orpc.sepaReturns.candidates({ query, limit: 30 }),
  });
  // Advanced: imported postings without an app debit. Only fetched when the
  // hidden option is switched on.
  const postingCandidates = useQuery({
    queryKey: ["sepaReturns.postingCandidates", query],
    queryFn: () => orpc.sepaReturns.postingCandidates({ query, limit: 30 }),
    enabled: advanced,
  });

  const create = useMutation({
    mutationFn: () =>
      selected!.kind === "posting"
        ? orpc.sepaReturns.createForPosting({
            sollStellungId: selected!.id,
            returnedOn,
            reasonCode: reasonCode ? (reasonCode as "AM04") : null,
            reasonText: reasonText.trim() || null,
            rueckgebuhr: rueckgebuhr.trim() || "0",
            notes: notes.trim() || null,
          })
        : orpc.sepaReturns.create({
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
      qc.invalidateQueries({ queryKey: ["sepaReturns.postingCandidates"] });
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
                  <div className="p-3">
                    <SkeletonText lines={3} />
                  </div>
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
                              kind: "item",
                              id: c.itemId,
                              label: `${c.memberName} · ${c.billingYear} · ${formatCurrency(c.amount)} · ${c.sequenceType} · ****${c.debtorIbanLast4}`,
                            })
                          }
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{c.memberName}</span>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              #{memberRef(c)}
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

              {advanced ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Importierte Posten (ohne App-Lastschrift)
                  </span>
                  <div className="max-h-72 overflow-y-auto rounded-lg border border-dashed">
                    {postingCandidates.isLoading ? (
                      <div className="p-3">
                        <SkeletonText lines={3} />
                      </div>
                    ) : !postingCandidates.data || postingCandidates.data.length === 0 ? (
                      <p className="p-3 text-sm text-muted-foreground">
                        Keine eingezogenen Importposten.
                      </p>
                    ) : (
                      <ul className="divide-y">
                        {postingCandidates.data.map((c) => (
                          <li key={c.sollStellungId}>
                            <button
                              type="button"
                              className="w-full cursor-pointer p-3 text-left text-sm hover:bg-accent"
                              onClick={() =>
                                setSelected({
                                  kind: "posting",
                                  id: c.sollStellungId,
                                  label: `${c.memberName} · ${c.billingYear} · ${formatCurrency(c.amount)} · Importposten`,
                                })
                              }
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-medium">{c.memberName}</span>
                                <span className="text-xs text-muted-foreground tabular-nums">
                                  #{memberRef(c)}
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                Beitragsjahr {c.billingYear} · {formatCurrency(c.amount)} · aus
                                Import
                              </p>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ) : null}

              <button
                type="button"
                className="self-start text-xs text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => setAdvanced((v) => !v)}
              >
                {advanced
                  ? "Importierte Posten ausblenden"
                  : "Erweitert: importierte Posten einbeziehen"}
              </button>
            </>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Datum Rückgabe">
            <DateField value={returnedOn} onChange={(v) => setReturnedOn(v)} />
          </Field>
          <Field label="R-Transaction-Code">
            <select
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
              className="h-9 rounded-lg border border-input bg-card px-3 text-sm shadow-soft"
            >
              <option value="">(kein Code)</option>
              {SEPA_RETURN_REASON_OPTIONS.map((o) => (
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

type CamtRow = Awaited<ReturnType<typeof orpc.sepaReturns.previewCamt>>["rows"][number];

function CamtImport({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<CamtRow[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [fileName, setFileName] = useState<string | null>(null);

  const preview = useMutation({
    mutationFn: (xml: string) => orpc.sepaReturns.previewCamt({ xml }),
    onSuccess: (r) => {
      setRows(r.rows);
      setWarnings(r.warnings);
      // Pre-select everything that cleanly matched an open debit.
      setSelected(
        new Set(r.rows.filter((row) => row.status === "matched").map((row) => row.index)),
      );
    },
    onError: (e: Error) =>
      toast.error("Datei konnte nicht gelesen werden", { description: e.message }),
  });

  const importMatched = useMutation({
    mutationFn: () => {
      const items = (rows ?? [])
        .filter((row) => row.status === "matched" && row.feeRunItemId && selected.has(row.index))
        .map((row) => ({
          feeRunItemId: row.feeRunItemId!,
          returnedOn: row.returnedOn ?? new Date().toISOString().slice(0, 10),
          reasonCode: row.reasonCode,
          reasonText: row.reasonText,
        }));
      return orpc.sepaReturns.importCamt({ items });
    },
    onSuccess: (r) => {
      toast.success(
        `${r.imported} Rückläufer importiert${r.skipped > 0 ? `, ${r.skipped} übersprungen` : ""}.`,
      );
      qc.invalidateQueries({ queryKey: ["sepaReturns.list"] });
      qc.invalidateQueries({ queryKey: ["sepaReturns.candidates"] });
      qc.invalidateQueries({ queryKey: ["dunning.open"] });
      onDone();
    },
    onError: (e: Error) => toast.error("Import fehlgeschlagen", { description: e.message }),
  });

  async function onFile(file: File) {
    setFileName(file.name);
    setRows(null);
    setSelected(new Set());
    const text = await file.text();
    preview.mutate(text);
  }

  const matchedLines = useMemo(
    () => (rows ?? []).filter((r) => r.status === "matched").map((r) => r.index),
    [rows],
  );
  const selectedCount = selected.size;

  return (
    <Card>
      <CardHeader>
        <CardTitle>camt.054 importieren</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Die Rücklastschrift-Datei der Bank hochladen. Die Rückläufer werden über die End-to-End-ID
          dem Beitragslauf zugeordnet. Bestätigte Treffer setzen die Sollstellung wieder offen.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-input bg-card px-4 py-2 text-sm font-medium shadow-soft hover:bg-muted">
            <Upload className="size-4" />
            Datei auswählen
            <input
              type="file"
              accept=".xml,.camt,text/xml,application/xml"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
                e.target.value = "";
              }}
            />
          </label>
          {fileName ? <span className="text-sm text-muted-foreground">{fileName}</span> : null}
          {preview.isPending ? (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Wird gelesen…
            </span>
          ) : null}
        </div>

        {warnings.length > 0 ? (
          <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
            {warnings.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
        ) : null}

        {rows && rows.length > 0 ? (
          <>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2" />
                    <th className="px-3 py-2 font-medium">Zuordnung</th>
                    <th className="px-3 py-2 text-right font-medium">Betrag</th>
                    <th className="px-3 py-2 font-medium">Grund</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const isMatched = r.status === "matched";
                    return (
                      <tr key={r.index} className="border-b border-border last:border-b-0">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            disabled={!isMatched}
                            checked={selected.has(r.index)}
                            onChange={(e) =>
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(r.index);
                                else next.delete(r.index);
                                return next;
                              })
                            }
                          />
                        </td>
                        <td className="px-3 py-2">
                          {r.member ? (
                            <div>
                              <div className="font-medium">{r.member.name}</div>
                              <div className="text-xs text-muted-foreground">
                                #{r.member.ref} · Beitragsjahr {r.member.billingYear}
                              </div>
                            </div>
                          ) : (
                            <div>
                              <div>{r.debtorName ?? "Unbekannt"}</div>
                              <div className="max-w-xs truncate font-mono text-xs text-muted-foreground">
                                {r.endToEndId ?? "ohne End-to-End-ID"}
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatCurrency(r.amount.toFixed(2))}
                        </td>
                        <td className="px-3 py-2">
                          {r.reasonCode ? (
                            <Badge
                              variant="warning"
                              title={sepaReturnReasonLabel(r.reasonCode) ?? undefined}
                            >
                              {r.reasonCode}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <CamtStatusBadge status={r.status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {matchedLines.length} zugeordnet · {selectedCount} ausgewählt
              </span>
              <Button
                disabled={selectedCount === 0 || importMatched.isPending}
                onClick={() => importMatched.mutate()}
              >
                {importMatched.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
                {selectedCount} importieren
              </Button>
            </div>
          </>
        ) : rows && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Rückläufer in der Datei erkannt.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CamtStatusBadge({ status }: { status: CamtRow["status"] }) {
  if (status === "matched") return <Badge variant="success">zugeordnet</Badge>;
  if (status === "already_returned") return <Badge variant="outline">bereits erfasst</Badge>;
  return <Badge variant="warning">kein Treffer</Badge>;
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
