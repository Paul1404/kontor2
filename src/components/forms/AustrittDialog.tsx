import { useMutation } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { toast } from "~/components/ui/toaster";
import { formatCurrency } from "~/lib/format";
import { orpc } from "~/lib/orpc";

type AbteilungRow = { austrittsdatum?: string | Date | null };
type VertragRow = { gekuendZum?: string | Date | null };
type SepaRow = { widerrufenAm?: string | Date | null; isDeleted?: boolean | null };
type SollRow = { status: string; openAmount: string | null };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Let a member leave the club in one step. Shows what the cascade will close
 * (open departments, contracts, SEPA mandates) and warns about money still
 * owed, then calls `members.austritt`. On success it offers the
 * Austrittsbestätigung via `onLeft`.
 */
export function AustrittDialog({
  open,
  onOpenChange,
  memberId,
  memberName,
  abteilungen,
  vertraege,
  sepa,
  sollstellungen,
  onLeft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberId: string;
  memberName: string;
  abteilungen: AbteilungRow[];
  vertraege: VertragRow[];
  sepa: SepaRow[];
  sollstellungen: SollRow[];
  onLeft: (austrittDatum: string) => void;
}) {
  const [austrittDatum, setAustrittDatum] = useState(today);
  const [revokeSepa, setRevokeSepa] = useState(true);

  const openAbteilungen = useMemo(
    () => abteilungen.filter((a) => a.austrittsdatum == null).length,
    [abteilungen],
  );
  const openVertraege = useMemo(
    () => vertraege.filter((v) => v.gekuendZum == null).length,
    [vertraege],
  );
  const activeSepa = useMemo(
    () => sepa.filter((s) => !s.isDeleted && s.widerrufenAm == null).length,
    [sepa],
  );
  const offeneForderung = useMemo(() => {
    let sum = 0;
    for (const s of sollstellungen) {
      if (s.status === "cancelled" || s.status === "paid") continue;
      const n = Number(s.openAmount ?? "0");
      if (Number.isFinite(n) && n > 0) sum += n;
    }
    return sum;
  }, [sollstellungen]);

  const mut = useMutation({
    mutationFn: () => orpc.members.austritt({ memberId, austrittDatum, revokeSepa }),
    onSuccess: (res) => {
      const parts = [
        `${res.abteilungen} Abteilung(en)`,
        `${res.vertraege} Vertrag/Verträge`,
        `${res.sepaMandate} Mandat(e)`,
      ];
      toast.success("Austritt eingetragen", { description: parts.join(", ") });
      onOpenChange(false);
      onLeft(austrittDatum);
    },
    onError: (err) =>
      toast.error("Austritt fehlgeschlagen", {
        description: err instanceof Error ? err.message : String(err),
      }),
  });

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(v) => {
        if (mut.isPending) return;
        onOpenChange(v);
      }}
      title="Mitglied austreten lassen"
      description={`Das Austrittsdatum wird auf ${memberName || "das Mitglied"} und alle offenen Datensätze übertragen.`}
      confirmLabel="Austritt eintragen"
      cancelLabel="Abbrechen"
      loading={mut.isPending}
      onConfirm={() => mut.mutate()}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="austritt-datum">Austritt zum</Label>
          <Input
            id="austritt-datum"
            type="date"
            value={austrittDatum}
            onChange={(e) => setAustrittDatum(e.target.value)}
            className="max-w-44"
          />
        </div>

        <div className="rounded-lg border border-border bg-card p-3">
          <p className="mb-2 font-medium text-foreground">Wird auf das Austrittsdatum gesetzt:</p>
          <ul className="flex flex-col gap-1 text-muted-foreground">
            <li>{openAbteilungen} offene Abteilungs-Mitgliedschaft(en)</li>
            <li>{openVertraege} laufende(r) Vertrag/Verträge</li>
            <li>
              {activeSepa} aktive(s) SEPA-Mandat(e)
              {revokeSepa ? "" : " (bleiben unverändert)"}
            </li>
          </ul>
        </div>

        {offeneForderung > 0 ? (
          <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <p className="text-foreground">
              Es bestehen noch offene Forderungen über {formatCurrency(String(offeneForderung))}.
              Der Austritt storniert diese nicht. Bitte separat klären.
            </p>
          </div>
        ) : null}

        <Switch
          id="austritt-sepa"
          checked={revokeSepa}
          onChange={(e) => setRevokeSepa(e.target.checked)}
          label="SEPA-Mandate widerrufen"
          description="Verhindert weitere Lastschriften nach dem Austritt."
        />
      </div>
    </ConfirmDialog>
  );
}
