import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import {
  buildInitialValues,
  buildPatch,
  MemberStammdatenForm,
  type StammdatenValues,
} from "~/components/forms/MemberStammdatenForm";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/mitglieder/$mitgliedsnummer_/bearbeiten")({
  component: EditMemberPage,
});

function EditMemberPage() {
  const { mitgliedsnummer } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["members.get", mitgliedsnummer],
    queryFn: () => orpc.members.get({ mitgliedsnummer }),
  });

  const mut = useMutation({
    mutationFn: async (values: StammdatenValues) => {
      if (!detail.data) return;
      const initialIban = ((detail.data.member as Record<string, unknown>).iban1 as string) ?? "";
      return orpc.members.update({
        memberId: detail.data.member.id,
        patch: buildPatch(values, initialIban.replace(/\s+/g, "").toUpperCase()) as never,
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["members.get", mitgliedsnummer] });
      await qc.invalidateQueries({ queryKey: ["members.list"] });
      navigate({
        to: "/app/mitglieder/$mitgliedsnummer",
        params: { mitgliedsnummer },
      });
    },
    onError: (e: unknown) => {
      setErrorMessage(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
    },
  });

  if (detail.isLoading) {
    return (
      <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-7 w-72" />
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {Array.from({ length: 10 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: pure visual placeholder
              <div key={i} className="flex flex-col gap-1.5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <div className="flex flex-col items-start gap-3">
        <Link
          to="/app/mitglieder"
          search={() => ({}) as never}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Zurück zur Liste
        </Link>
        <p className="text-destructive">Mitglied nicht gefunden.</p>
      </div>
    );
  }

  const { member } = detail.data;
  const initial = buildInitialValues(member as Record<string, unknown>);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          to="/app/mitglieder/$mitgliedsnummer"
          params={{ mitgliedsnummer }}
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Zurück zum Profil
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {[member.titel1, member.vorname, member.nachname].filter(Boolean).join(" ")} bearbeiten
        </h1>
        <p className="text-sm text-muted-foreground">
          Mitgliedsnummer: <span className="tabular-nums">{member.mitglnr}</span> · AdrNr{" "}
          {member.adrNr}
        </p>
      </div>

      <MemberStammdatenForm
        initial={initial}
        submitting={mut.isPending}
        errorMessage={errorMessage}
        onCancel={() =>
          navigate({
            to: "/app/mitglieder/$mitgliedsnummer",
            params: { mitgliedsnummer },
          })
        }
        onSubmit={(values) => {
          setErrorMessage(null);
          mut.mutate(values);
        }}
      />
    </div>
  );
}
