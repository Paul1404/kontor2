import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Landmark, Loader2, Search, Upload, X } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { toast } from "~/components/ui/toaster";
import { formatCurrency } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/zahlungsabgleich")({
  component: ZahlungsabgleichPage,
});

type Proposal = Awaited<ReturnType<typeof orpc.payments.matchBankCsv>>["proposals"][number];
type Posting = NonNullable<Proposal["match"]>;

function matchForProposal(proposal: Proposal, manualMatches: Map<number, Posting>): Posting | null {
  return manualMatches.get(proposal.line) ?? proposal.match;
}

function ZahlungsabgleichPage() {
  const qc = useQueryClient();
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [sourceHash, setSourceHash] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [manualMatches, setManualMatches] = useState<Map<number, Posting>>(new Map());
  const [assignmentLine, setAssignmentLine] = useState<number | null>(null);
  const [assignmentQuery, setAssignmentQuery] = useState("");

  const openPostings = useQuery({
    queryKey: ["payments.openPostings", assignmentQuery],
    queryFn: () => orpc.payments.openPostings({ query: assignmentQuery, limit: 30 }),
    enabled: assignmentLine !== null,
  });

  const match = useMutation({
    mutationFn: (csv: string) => orpc.payments.matchBankCsv({ csv }),
    onSuccess: (r) => {
      setProposals(r.proposals);
      setWarnings(r.warnings);
      setSourceHash(r.sourceHash);
      setManualMatches(new Map());
      setAssignmentLine(null);
      setAssignmentQuery("");
      // Pre-select high-confidence matches.
      setSelected(
        new Set(r.proposals.filter((p) => p.match && p.confidence === "high").map((p) => p.line)),
      );
    },
    onError: (e: Error) =>
      toast.error("Datei konnte nicht gelesen werden", { description: e.message }),
  });

  const apply = useMutation({
    mutationFn: () => {
      const items = (proposals ?? [])
        .filter((p) => matchForProposal(p, manualMatches) && selected.has(p.line))
        .map((p) => ({
          sollStellungId: matchForProposal(p, manualMatches)!.sollStellungId,
          amount: p.amount,
        }));
      if (!sourceHash) throw new Error("Die Quelldatei muss erneut eingelesen werden.");
      return orpc.payments.apply({ sourceHash, items });
    },
    onSuccess: async (r) => {
      setConfirm(false);
      toast.success(
        `${r.applied} Zahlung(en) verbucht${r.skipped > 0 ? `, ${r.skipped} übersprungen` : ""}.`,
      );
      setProposals(null);
      setSelected(new Set());
      setFileName(null);
      setSourceHash(null);
      setManualMatches(new Map());
      setAssignmentLine(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["dashboard.insights"] }),
        qc.invalidateQueries({ queryKey: ["dunning.open"] }),
        qc.invalidateQueries({ queryKey: ["members.get"] }),
      ]);
    },
    onError: (e: Error) => {
      setConfirm(false);
      toast.error("Verbuchen fehlgeschlagen", { description: e.message });
    },
  });

  async function onFile(file: File) {
    setFileName(file.name);
    const text = await file.text();
    match.mutate(text);
  }

  // Every matched line can be ticked manually; "select all" only picks the
  // high-confidence ones so an amount-mismatched medium guess is never booked
  // in bulk by accident.
  const matchedLines = useMemo(
    () => (proposals ?? []).filter((p) => matchForProposal(p, manualMatches)).map((p) => p.line),
    [proposals, manualMatches],
  );
  const highLines = useMemo(
    () => (proposals ?? []).filter((p) => p.match && p.confidence === "high").map((p) => p.line),
    [proposals],
  );
  const selectedCount = selected.size;
  const selectedSum = useMemo(
    () =>
      (proposals ?? [])
        .filter((p) => matchForProposal(p, manualMatches) && selected.has(p.line))
        .reduce(
          (s, p) =>
            s + Math.min(p.amount, matchForProposal(p, manualMatches)?.openAmount ?? p.amount),
          0,
        ),
    [proposals, selected, manualMatches],
  );

  function choosePosting(line: number, posting: Posting) {
    setManualMatches((previous) => {
      const next = new Map(previous);
      next.set(line, posting);
      return next;
    });
    setSelected((previous) => new Set(previous).add(line));
    setAssignmentLine(null);
    setAssignmentQuery("");
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Landmark className="size-6 text-brand" /> Zahlungsabgleich
        </h1>
        <p className="text-sm text-muted-foreground">
          CSV-Export der Bankumsätze hochladen. Gutschriften werden offenen Posten zugeordnet;
          bestätigte Treffer werden als bezahlt verbucht.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 p-5">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-input bg-card px-4 py-2 text-sm font-medium shadow-soft hover:bg-muted">
            <Upload className="size-4" />
            CSV auswählen
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
                e.target.value = "";
              }}
            />
          </label>
          {fileName ? <span className="text-sm text-muted-foreground">{fileName}</span> : null}
          {match.isPending ? (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Gleiche ab…
            </span>
          ) : null}
        </CardContent>
      </Card>

      {warnings.length > 0 ? (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="p-4 text-sm">
            {warnings.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {proposals && proposals.length > 0 ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">
              {proposals.length} Buchungen · {matchedLines.length} zugeordnet
            </CardTitle>
            <Button
              type="button"
              onClick={() => setConfirm(true)}
              disabled={selectedCount === 0 || apply.isPending}
            >
              {apply.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              {selectedCount} verbuchen ({formatCurrency(selectedSum.toFixed(2))})
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label="Alle sicheren Treffer auswählen"
                        title="Alle sicheren Treffer auswählen"
                        checked={highLines.length > 0 && highLines.every((l) => selected.has(l))}
                        onChange={(e) =>
                          setSelected(e.target.checked ? new Set(highLines) : new Set())
                        }
                      />
                    </th>
                    <th className="px-3 py-2 font-medium">Buchung</th>
                    <th className="px-3 py-2 text-right font-medium">Betrag</th>
                    <th className="px-3 py-2 font-medium">Zuordnung</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {proposals.map((p) => {
                    const isSel = selected.has(p.line);
                    const matchForRow = matchForProposal(p, manualMatches);
                    const manuallyAssigned = manualMatches.has(p.line);
                    return (
                      <Fragment key={p.line}>
                        <tr className="border-b border-border last:border-b-0">
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              aria-label={`Buchung in Zeile ${p.line} auswählen`}
                              disabled={!matchForRow}
                              checked={isSel}
                              onChange={(e) =>
                                setSelected((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(p.line);
                                  else next.delete(p.line);
                                  return next;
                                })
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-medium">{p.name || "Ohne Namen"}</div>
                            <div className="max-w-md truncate text-xs text-muted-foreground">
                              {p.purpose}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatCurrency(p.amount.toFixed(2))}
                          </td>
                          <td className="px-3 py-2">
                            {matchForRow ? (
                              <div>
                                <div>{matchForRow.memberName}</div>
                                <div className="text-xs text-muted-foreground">
                                  {matchForRow.billingYear} · offen{" "}
                                  {formatCurrency(matchForRow.openAmount.toFixed(2))}
                                </div>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">{p.reason}</span>
                            )}
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="mt-1 h-7 px-2 text-xs"
                              onClick={() => {
                                setAssignmentLine(assignmentLine === p.line ? null : p.line);
                                setAssignmentQuery("");
                              }}
                            >
                              {matchForRow ? "Zuordnung ändern" : "Zuordnen"}
                            </Button>
                          </td>
                          <td className="px-3 py-2">
                            {manuallyAssigned ? (
                              <Badge variant="info">manuell</Badge>
                            ) : (
                              <ConfidenceBadge confidence={p.confidence} />
                            )}
                          </td>
                        </tr>
                        {assignmentLine === p.line ? (
                          <tr key={`${p.line}-assignment`} className="border-b bg-muted/20">
                            <td colSpan={5} className="px-3 py-3">
                              <div className="mx-auto flex max-w-3xl flex-col gap-2">
                                <div className="flex items-center gap-2">
                                  <div className="relative flex-1">
                                    <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                                    <input
                                      value={assignmentQuery}
                                      onChange={(e) => setAssignmentQuery(e.target.value)}
                                      placeholder="Mitglied, Nummer oder Beitragsjahr suchen"
                                      aria-label="Offene Forderungen durchsuchen"
                                      className="h-9 w-full rounded-lg border border-input bg-card pl-8 pr-3 text-sm"
                                    />
                                  </div>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-9"
                                    aria-label="Zuordnung schließen"
                                    onClick={() => setAssignmentLine(null)}
                                  >
                                    <X className="size-4" />
                                  </Button>
                                </div>
                                {openPostings.isLoading ? (
                                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Loader2 className="size-4 animate-spin" /> Suche…
                                  </span>
                                ) : openPostings.isError ? (
                                  <div className="flex items-center justify-between gap-3 text-sm text-destructive">
                                    <span>Forderungen konnten nicht geladen werden.</span>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => openPostings.refetch()}
                                    >
                                      Erneut versuchen
                                    </Button>
                                  </div>
                                ) : openPostings.data?.length ? (
                                  <ul className="max-h-64 divide-y overflow-y-auto rounded-lg border bg-card">
                                    {openPostings.data.map((posting) => (
                                      <li key={posting.sollStellungId}>
                                        <button
                                          type="button"
                                          className="flex w-full items-center justify-between gap-4 p-3 text-left text-sm hover:bg-muted"
                                          onClick={() => choosePosting(p.line, posting)}
                                        >
                                          <span>
                                            <span className="font-medium">
                                              {posting.memberName}
                                            </span>
                                            <span className="ml-2 text-xs text-muted-foreground">
                                              #{posting.reference} · {posting.billingYear}
                                            </span>
                                          </span>
                                          <span className="shrink-0 tabular-nums">
                                            offen {formatCurrency(posting.openAmount.toFixed(2))}
                                          </span>
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <span className="text-sm text-muted-foreground">
                                    Keine passende offene Forderung gefunden.
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : proposals && proposals.length === 0 ? (
        <p className="text-sm text-muted-foreground">Keine Buchungen in der Datei erkannt.</p>
      ) : null}

      <ConfirmDialog
        open={confirm}
        onOpenChange={(o) => {
          if (!apply.isPending) setConfirm(o);
        }}
        title="Zahlungen verbuchen"
        description={`${selectedCount} zugeordnete Zahlung(en) über ${formatCurrency(selectedSum.toFixed(2))} werden als bezahlt verbucht. Fortfahren?`}
        confirmLabel="Verbuchen"
        loading={apply.isPending}
        onConfirm={() => apply.mutate()}
      />
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: "high" | "medium" | "none" }) {
  if (confidence === "high") return <Badge variant="success">sicher</Badge>;
  if (confidence === "medium") return <Badge variant="warning">prüfen</Badge>;
  return <Badge variant="outline">offen</Badge>;
}
