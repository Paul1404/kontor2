import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Input } from "~/components/ui/input";
import { formatCurrency } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export function ContractSwitchDialog({
  contractId,
  open,
  onOpenChange,
  onDone,
}: {
  contractId: string;
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onDone: () => void;
}) {
  const [art, setArt] = useState<number>(0);
  const [effectiveDate, setDate] = useState(new Date().toISOString().slice(0, 10));
  const tariffs = useQuery({
    queryKey: ["feeTypes.list"],
    queryFn: () => orpc.feeTypes.list(),
    enabled: open,
  });
  const plan = useQuery({
    queryKey: ["contractSwitch.preview", contractId, art, effectiveDate],
    queryFn: () => orpc.contractSwitch.preview({ contractId, art, effectiveDate }),
    enabled: open && !!art && /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate),
    retry: false,
  });
  const save = useMutation({
    mutationFn: () =>
      orpc.contractSwitch.commit({
        contractId,
        art,
        effectiveDate,
        revision: plan.data!.revision,
        confirm: true,
      }),
    onSuccess: () => {
      onOpenChange(false);
      onDone();
    },
  });
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Tarif wechseln"
      confirmLabel="Vertragswechsel speichern"
      loading={save.isPending}
      confirmDisabled={!plan.data || plan.isFetching || !!plan.error}
      onConfirm={() => save.mutate()}
    >
      <label className="text-sm">
        Neuer Tarif
        <select
          aria-label="Neuer Tarif"
          value={art}
          onChange={(e) => setArt(Number(e.target.value))}
          className="mt-1 w-full rounded border p-2"
        >
          <option value={0}>Bitte wählen</option>
          {tariffs.data
            ?.filter((t) => t.nichAktiv !== "J")
            .map((t) => (
              <option key={t.art} value={t.art}>
                {t.bezeichnung} ({formatCurrency(t.betrag1)})
              </option>
            ))}
        </select>
      </label>
      <label className="text-sm" htmlFor="switch-date">
        Wirksam ab
        <Input
          id="switch-date"
          type="date"
          aria-label="Wirksam ab"
          value={effectiveDate}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      {plan.data ? (
        <div className="text-sm">
          <p>
            {plan.data.oldName}: {formatCurrency(plan.data.oldAmount)} → {plan.data.newName}:{" "}
            {formatCurrency(plan.data.newAmount)}
          </p>
          <p>Der alte Vertrag endet zum Wechsel. Der Nachfolger beginnt am {effectiveDate}.</p>
          <p>
            Bereits gestellte Jahresbeiträge bleiben erhalten. Für diese Jahre entsteht keine zweite
            Sollstellung.
          </p>
          {plan.data.postings.map((p) => (
            <p key={p.id}>
              {p.year}: {formatCurrency(p.amount)},{" "}
              {(
                {
                  open: "Offen",
                  pending: "Ausstehend",
                  eingezogen: "Eingezogen",
                  paid: "Bezahlt",
                  returned: "Rückläufer",
                  cancelled: "Storniert",
                } as Record<string, string>
              )[p.status] ?? p.status}
            </p>
          ))}
        </div>
      ) : null}
      {plan.error || save.error ? (
        <p role="alert" className="text-destructive">
          {(plan.error || save.error)?.message}
        </p>
      ) : null}
    </ConfirmDialog>
  );
}
