import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FileSignature, Loader2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { toast } from "~/components/ui/toaster";
import { EMPTY_VALUE, formatDate } from "~/lib/format";
import { orpc } from "~/lib/orpc";

type Kandidat = {
  zahlerMemberId: string;
  reference: string;
  name: string;
  unterschriftDatum: string | Date | null;
  hasIban: boolean;
  zahltFuer: string[];
  plan:
    | { kind: "create" }
    | { kind: "reactivate"; mandateId: string }
    | { kind: "skip"; reason: string };
  mandatsNr?: string | null;
  vertreterCandidate?: {
    relationshipId: string;
    toMemberId: string;
    name: string;
    reference: string;
    strong: boolean;
  };
  payerContactSuggestion?: {
    name: string;
    vorname: string;
    nachname: string;
  };
};

/**
 * Zahler ohne nutzbares SEPA-Mandat, mit Nachtrag-Plan. Das Mandat gehört zum
 * Zahler (Familien-Zahler oder Vertreter bei Minderjährigen, sonst das
 * Mitglied selbst), nie zum Kind. Fehlende Mandate werden mit Unterschrift =
 * früheste unterschriebene Beitrittserklärung nachgetragen, inaktiv gesetzte
 * Import-Mandate reaktiviert. Minderjährige ohne Vertreter oder Familie
 * erscheinen als Datenqualitätsfall ohne Aktion.
 */
export function MandateNachtragCard({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);

  const kandidaten = useQuery({
    queryKey: ["sepa.nachtragKandidaten"],
    queryFn: () => orpc.sepa.nachtragKandidaten(),
  });

  const rows = (kandidaten.data ?? []) as Kandidat[];
  const actionable = rows.filter((r) => r.plan.kind !== "skip");

  const nachtragen = useMutation({
    mutationFn: () =>
      orpc.sepa.mandateNachtragen({ memberIds: actionable.map((r) => r.zahlerMemberId) }),
    onSuccess: async (r) => {
      setConfirm(false);
      toast.success(
        `${r.created} Mandate nachgetragen, ${r.reactivated} reaktiviert${r.skipped > 0 ? `, ${r.skipped} übersprungen` : ""}.`,
      );
      await qc.invalidateQueries({ queryKey: ["sepa.nachtragKandidaten"] });
    },
    onError: (e: Error) => {
      setConfirm(false);
      toast.error("Nachtragen fehlgeschlagen", { description: e.message });
    },
  });

  if (kandidaten.isLoading || rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <FileSignature className="size-5 text-brand" /> Mandate nachtragen
          <Badge variant="secondary">{rows.length}</Badge>
        </CardTitle>
        {canEdit && actionable.length > 0 ? (
          <Button size="sm" onClick={() => setConfirm(true)} disabled={nachtragen.isPending}>
            {nachtragen.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            {actionable.length} Mandate nachtragen
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Zahler ohne nutzbares SEPA-Mandat. Das Mandat gehört zum Zahler, also dem Familien-Zahler
          oder Vertreter bei Minderjährigen, nie zum Kind selbst. Die Beitrittserklärung enthält das
          Mandat: fehlende Datensätze werden mit Unterschrift gleich frühester Beitrittserklärung
          nachgetragen, inaktiv gesetzte Import-Mandate reaktiviert. Minderjährige ohne Vertreter
          oder Familie brauchen erst Datenpflege.
        </p>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="py-1.5 pr-3 font-medium">Zahler</th>
              <th className="py-1.5 pr-3 font-medium">Zahlt für</th>
              <th className="py-1.5 pr-3 font-medium">Unterschrift</th>
              <th className="py-1.5 pr-3 font-medium">IBAN</th>
              <th className="py-1.5 font-medium">Plan</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.zahlerMemberId}>
                <td className="py-1.5 pr-3">
                  <Link
                    to="/app/mitglieder/$mitgliedsnummer"
                    params={{ mitgliedsnummer: r.reference }}
                    className="text-primary hover:underline"
                  >
                    {r.name}
                  </Link>
                </td>
                <td className="py-1.5 pr-3 text-muted-foreground">
                  {r.zahltFuer.length > 0 ? r.zahltFuer.join(", ") : "sich selbst"}
                </td>
                <td className="py-1.5 pr-3 tabular-nums text-muted-foreground">
                  {r.unterschriftDatum ? formatDate(r.unterschriftDatum) : EMPTY_VALUE}
                </td>
                <td className="py-1.5 pr-3">
                  {r.hasIban ? "vorhanden" : <span className="text-warning">fehlt</span>}
                </td>
                <td className="py-1.5">
                  {r.plan.kind === "create" ? (
                    <Badge variant="success">Nachtragen</Badge>
                  ) : r.plan.kind === "reactivate" ? (
                    <Badge variant="success">
                      Reaktivieren{r.mandatsNr ? ` (${r.mandatsNr})` : ""}
                    </Badge>
                  ) : r.vertreterCandidate ? (
                    <AssignVertreterButton
                      minorMemberId={r.zahlerMemberId}
                      candidate={r.vertreterCandidate}
                      canEdit={canEdit}
                      onDone={() => qc.invalidateQueries({ queryKey: ["sepa.nachtragKandidaten"] })}
                    />
                  ) : r.payerContactSuggestion ? (
                    <ResolveViaKontoinhaberButton
                      minorMemberId={r.zahlerMemberId}
                      suggestion={r.payerContactSuggestion}
                      canEdit={canEdit}
                      onDone={() => qc.invalidateQueries({ queryKey: ["sepa.nachtragKandidaten"] })}
                    />
                  ) : (
                    <Badge variant="warning">{r.plan.reason}</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>

      <ConfirmDialog
        open={confirm}
        onOpenChange={(o) => {
          if (!nachtragen.isPending) setConfirm(o);
        }}
        title="Mandate nachtragen"
        description={`${actionable.length} Mandate werden beim jeweiligen Zahler nachgetragen bzw. reaktiviert (Unterschrift = früheste Beitrittserklärung). Jede Änderung wird auditiert. Fortfahren?`}
        confirmLabel="Nachtragen"
        loading={nachtragen.isPending}
        onConfirm={() => nachtragen.mutate()}
      />
    </Card>
  );
}

/**
 * Macht aus dem Sackgassen-Badge "ohne Vertreter" eine Aktion: die vorhandene
 * Beziehung zum Erwachsenen als Vertreter übernehmen. Danach löst der Zahler
 * sich auf und das Mandat wird nachtrag- bzw. reaktivierbar.
 */
function AssignVertreterButton({
  minorMemberId,
  candidate,
  canEdit,
  onDone,
}: {
  minorMemberId: string;
  candidate: NonNullable<Kandidat["vertreterCandidate"]>;
  canEdit: boolean;
  onDone: () => void | Promise<void>;
}) {
  const assign = useMutation({
    mutationFn: () =>
      orpc.sepa.assignVertreter({ minorMemberId, relationshipId: candidate.relationshipId }),
    onSuccess: async (r) => {
      toast.success(
        r.ibanMoved
          ? `${candidate.name} als Vertreter übernommen, Bankverbindung übertragen`
          : `${candidate.name} als Vertreter übernommen`,
      );
      await onDone();
    },
    onError: (e: Error) => toast.error("Übernehmen fehlgeschlagen", { description: e.message }),
  });

  if (!canEdit) {
    return <Badge variant="warning">Minderjährig: Vertreter vorhanden, nicht gepflegt</Badge>;
  }
  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => assign.mutate()}
        disabled={assign.isPending}
        title={`Beziehung zu ${candidate.name} als Vertreter übernehmen`}
      >
        {assign.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
        {candidate.name} als Vertreter
      </Button>
      {candidate.strong ? (
        <span className="text-xs text-muted-foreground">passt zum Kontoinhaber</span>
      ) : null}
    </div>
  );
}

/**
 * Schadenbegrenzung ohne Beziehung: aus dem Kontoinhaber-Namen einen
 * Zahler-Kontakt ableiten (oder einen bestehenden verknüpfen) und als Vertreter
 * setzen. Die Bankverbindung des Kindes wandert auf den neuen Kontakt.
 */
function ResolveViaKontoinhaberButton({
  minorMemberId,
  suggestion,
  canEdit,
  onDone,
}: {
  minorMemberId: string;
  suggestion: NonNullable<Kandidat["payerContactSuggestion"]>;
  canEdit: boolean;
  onDone: () => void | Promise<void>;
}) {
  const resolve = useMutation({
    mutationFn: () => orpc.sepa.resolveMinorViaKontoinhaber({ minorMemberId }),
    onSuccess: async (r) => {
      toast.success(
        r.action === "linked"
          ? `Mit ${suggestion.name} verknüpft`
          : `Kontakt ${suggestion.name} angelegt`,
      );
      await onDone();
    },
    onError: (e: Error) => toast.error("Anlegen fehlgeschlagen", { description: e.message }),
  });

  if (!canEdit) {
    return <Badge variant="warning">Minderjährig: Kontoinhaber vorhanden, kein Zahler</Badge>;
  }
  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => resolve.mutate()}
        disabled={resolve.isPending}
        title={`Kontakt-Zahler ${suggestion.name} aus dem Kontoinhaber anlegen`}
      >
        {resolve.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
        Kontakt {suggestion.name} anlegen
      </Button>
      <span className="text-xs text-muted-foreground">aus Kontoinhaber</span>
    </div>
  );
}
