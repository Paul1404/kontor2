import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { toast } from "~/components/ui/toaster";
import { orpc } from "~/lib/orpc";
export function FamilyMigration() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const plan = useQuery({
    queryKey: ["familien.migrationPreview"],
    queryFn: () => orpc.familien.migrationPreview(),
    enabled: open,
    staleTime: 0,
  });
  const apply = useMutation({
    mutationFn: () => orpc.familien.migrationApply({ hash: plan.data!.hash, confirm: true }),
    onSuccess: async (r) => {
      toast.success(`${r.applied} Familien übernommen, ${r.unresolved} Prüffälle bleiben offen`);
      setOpen(false);
      await qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Altzuordnungen prüfen
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Familien aus Altzuordnungen übernehmen"
        confirmLabel="Eindeutige Fälle übernehmen"
        confirmDisabled={
          !plan.data || plan.isFetching || !plan.data.proposals.some((p) => !p.issues.length)
        }
        loading={apply.isPending}
        onConfirm={() => apply.mutate()}
      >
        <div className="max-h-80 overflow-y-auto text-sm">
          {plan.data?.proposals.map((p) => (
            <div className="mb-3 rounded border p-2" key={p.id}>
              <strong>{p.name}</strong>
              <p>{p.persons.map((m) => m.name).join(", ")}</p>
              <p>Zahler: {p.persons.find((m) => m.id === p.payer)?.name ?? "Ungeklärt"}</p>
              <p>
                Empfänger für Kinder:{" "}
                {p.persons.find((m) => m.id === p.guardian)?.name ?? "Nicht zugeordnet"}
              </p>
              {p.issues.map((i) => (
                <p className="text-destructive" key={i}>
                  {i}
                </p>
              ))}
            </div>
          ))}
          {plan.data && !plan.data.proposals.length ? <p>Keine offenen Altzuordnungen.</p> : null}
          {plan.error ? <p role="alert">{plan.error.message}</p> : null}
        </div>
      </ConfirmDialog>
    </>
  );
}
