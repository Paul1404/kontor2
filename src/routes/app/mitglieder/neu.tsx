import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import {
  buildPatch,
  EMPTY_STAMM,
  MemberStammdatenForm,
  type StammdatenValues,
} from "~/components/forms/MemberStammdatenForm";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/mitglieder/neu")({
  component: NewMemberPage,
});

function NewMemberPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [mitglnr, setMitglnr] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: (values: StammdatenValues) =>
      orpc.members.create({
        mitglnr: mitglnr.trim().length > 0 ? mitglnr.trim() : null,
        patch: buildPatch(values) as never,
      }),
    onSuccess: async (result) => {
      await qc.invalidateQueries({ queryKey: ["members.list"] });
      navigate({
        to: "/app/mitglieder/$mitgliedsnummer",
        params: { mitgliedsnummer: result.mitglnr ?? String(result.adrNr) },
      });
    },
    onError: (e: unknown) => {
      setErrorMessage(e instanceof Error ? e.message : "Anlage fehlgeschlagen.");
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          to="/app/mitglieder"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Zurück zur Liste
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Neues Mitglied</h1>
        <p className="text-sm text-muted-foreground">
          Mitgliedsnummer und AdrNr werden automatisch vergeben, wenn leer gelassen.
        </p>
      </div>

      <MemberStammdatenForm
        initial={EMPTY_STAMM}
        submitting={mut.isPending}
        errorMessage={errorMessage}
        submitLabel="Anlegen"
        mitglnrInput={{ value: mitglnr, onChange: setMitglnr }}
        onCancel={() => navigate({ to: "/app/mitglieder" })}
        onSubmit={(values) => {
          setErrorMessage(null);
          mut.mutate(values);
        }}
      />
    </div>
  );
}
