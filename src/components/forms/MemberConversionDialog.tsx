import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Input } from "~/components/ui/input";
import { orpc } from "~/lib/orpc";

export function MemberConversionDialog({
  memberId,
  open,
  onOpenChange,
  onDone,
}: {
  memberId: string;
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onDone: (reference: string) => void;
}) {
  const [reason, setReason] = useState("");
  const plan = useQuery({
    queryKey: ["memberConversion.preview", memberId],
    queryFn: () => orpc.memberConversion.preview({ memberId }),
    enabled: open,
    staleTime: 0,
  });
  const save = useMutation({
    mutationFn: () =>
      orpc.memberConversion.commit({
        memberId,
        expectedUpdatedAt: plan.data!.updatedAt!,
        kontaktNo: plan.data!.kontaktNo,
        reason,
        confirm: true,
      }),
    onSuccess: (r) => onDone(r.kontaktNo),
  });
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Fehlerhafte Mitgliedschaft korrigieren"
      description="Nur für versehentlich als Mitglied angelegte Personen. Familienrollen und Mandate bleiben erhalten. Portalzugänge werden beendet. Die bisherige Mitgliedsnummer bleibt suchbar; die neue Kontaktnummer wird mit der Vorschau angezeigt."
      confirmLabel="In Kontakt umwandeln"
      loading={save.isPending}
      confirmDisabled={!plan.data || !!plan.data.blockers.length || reason.trim().length < 5}
      onConfirm={() => save.mutate()}
    >
      {plan.data ? (
        <>
          <p className="text-sm">
            Bisherige Nummer: {plan.data.memberNo}. Neue Kontaktnummer: {plan.data.kontaktNo}
          </p>
          <dl className="text-sm">
            {Object.entries(plan.data.counts).map(([key, value]) => (
              <div key={key}>
                {
                  (
                    {
                      contracts: "Verträge",
                      departments: "Abteilungen",
                      postings: "Sollstellungen",
                      dunning: "Mahnungen",
                      runs: "Beitragslaufpositionen",
                      families: "Familien",
                      mandates: "SEPA-Mandate",
                      portal: "Portalzugänge",
                    } as Record<string, string>
                  )[key]
                }
                : {value}
              </div>
            ))}
          </dl>
          {plan.data.blockers.map((b) => (
            <p className="text-sm text-destructive" key={b}>
              {b}
            </p>
          ))}
        </>
      ) : (
        <p>Vorschau wird geladen…</p>
      )}
      <Input
        aria-label="Grund der Korrektur"
        placeholder="Warum wurde die Person versehentlich als Mitglied angelegt?"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {plan.error || save.error ? (
        <p role="alert" className="text-destructive">
          {(plan.error || save.error)?.message}
        </p>
      ) : null}
    </ConfirmDialog>
  );
}
