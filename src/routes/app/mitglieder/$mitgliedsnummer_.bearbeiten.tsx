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
import { toast } from "~/components/ui/toaster";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/mitglieder/$mitgliedsnummer_/bearbeiten")({
  // `?fokus=<field>` deep-links from a Datenqualitäts-Befund to the field to fix.
  validateSearch: (search: Record<string, unknown>): { fokus?: string } => ({
    fokus: typeof search.fokus === "string" ? search.fokus : undefined,
  }),
  component: EditMemberPage,
});

function EditMemberPage() {
  const { mitgliedsnummer } = Route.useParams();
  const { fokus } = Route.useSearch();
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
      // Optimistic-lock token: the updatedAt we loaded. If someone else saved
      // in the meantime the server rejects this with a CONFLICT.
      const loadedUpdatedAt = (detail.data.member as Record<string, unknown>).updatedAt;
      const expectedUpdatedAt =
        loadedUpdatedAt instanceof Date
          ? loadedUpdatedAt.toISOString()
          : ((loadedUpdatedAt as string | null) ?? null);
      return orpc.members.update({
        memberId: detail.data.member.id,
        patch: buildPatch(values, initialIban.replace(/\s+/g, "").toUpperCase()) as never,
        expectedUpdatedAt,
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["members.get", mitgliedsnummer] });
      await qc.invalidateQueries({ queryKey: ["members.list"] });
      toast.success("Änderungen gespeichert.");
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
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-muted-foreground">
          <span>
            {member.memberNo ? "Mitgliedsnummer" : "Kontaktnummer"}:{" "}
            <span className="tabular-nums text-foreground">
              {member.memberNo ?? member.kontaktNo}
            </span>
          </span>
          {member.mitgliedsnummer ? (
            <span title="Frühere Linear-Mitgliedsnummer">
              <span className="text-muted-foreground/50">·</span> Alt-Nr.{" "}
              <span className="tabular-nums">{member.mitgliedsnummer}</span>
            </span>
          ) : null}
          <span title="Interne Adressnummer">
            <span className="text-muted-foreground/50">·</span> AdrNr{" "}
            <span className="tabular-nums">{member.adrNr}</span>
          </span>
        </p>
      </div>

      <MemberStammdatenForm
        // Remount the form per member so its seeded state resets only when the
        // record actually changes — never mid-edit on a background refetch.
        key={(member as Record<string, unknown>).id as string}
        initial={initial}
        focusField={fokus}
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
