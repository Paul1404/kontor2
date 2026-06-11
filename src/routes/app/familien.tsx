import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Crown, Loader2, Sparkles, Trash2, UsersRound } from "lucide-react";
import { useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { QueryError } from "~/components/ui/query-error";
import { toast } from "~/components/ui/toaster";
import { formatDate } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/familien")({
  component: FamilienPage,
});

function FamilienPage() {
  const qc = useQueryClient();
  const familien = useQuery({
    queryKey: ["familien.list"],
    queryFn: () => orpc.familien.list(),
  });
  const proposals = useQuery({
    queryKey: ["familien.proposals"],
    queryFn: () => orpc.familien.proposals(),
  });
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["familien.list"] }),
      qc.invalidateQueries({ queryKey: ["familien.proposals"] }),
      qc.invalidateQueries({ queryKey: ["familien.forMember"] }),
    ]);
  };

  const remove = useMutation({
    mutationFn: (id: string) => orpc.familien.remove({ id }),
    onSuccess: async () => {
      setDeleteTarget(null);
      await invalidate();
      toast.success("Familie gelöscht");
    },
    onError: (e: Error) => toast.error("Löschen fehlgeschlagen", { description: e.message }),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <UsersRound className="size-6 text-brand" /> Familien
        </h1>
        <p className="text-sm text-muted-foreground">
          Wer gehört zu welcher Familienmitgliedschaft, und wer zahlt. Vorschläge entstehen aus
          Familienbeitrag, Verknüpfungen und gemeinsamer Adresse. Übernommen wird nur per Hand.
        </p>
      </div>

      {familien.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Wird geladen…
        </div>
      ) : familien.isError ? (
        <QueryError onRetry={() => familien.refetch()} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Bestehende Familien ({familien.data?.length ?? 0})</CardTitle>
          </CardHeader>
          <CardContent>
            {familien.data && familien.data.length > 0 ? (
              <ul className="flex flex-col divide-y divide-border">
                {familien.data.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">{f.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {f.aktiveMitglieder} Mitglieder
                        {f.zahler ? (
                          <>
                            {" · Zahler: "}
                            <Link
                              to="/app/mitglieder/$mitgliedsnummer"
                              params={{ mitgliedsnummer: f.zahler.reference }}
                              className="text-primary hover:underline"
                            >
                              {f.zahler.name}
                            </Link>
                          </>
                        ) : null}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Familie ${f.name} löschen`}
                      onClick={() => setDeleteTarget({ id: f.id, name: f.name })}
                    >
                      <Trash2 className="size-4 text-muted-foreground" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Noch keine Familien angelegt. Unten stehen Vorschläge aus den Bestandsdaten.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-brand" /> Vorschläge aus den Bestandsdaten
            {proposals.data ? <Badge variant="secondary">{proposals.data.length}</Badge> : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {proposals.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Prüfe Familienbeitrag, Verknüpfungen und
              Adressen…
            </div>
          ) : proposals.isError ? (
            <QueryError onRetry={() => proposals.refetch()} />
          ) : proposals.data && proposals.data.length > 0 ? (
            proposals.data.map((p) => (
              <ProposalCard key={p.zahler.id} proposal={p} onCreated={invalidate} />
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              Keine offenen Vorschläge. Jeder laufende Familienbeitrag ist einer Familie zugeordnet.
            </p>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o && !remove.isPending) setDeleteTarget(null);
        }}
        aria-label="Familie löschen"
        title="Familie löschen"
        description={
          deleteTarget
            ? `${deleteTarget.name} löschen? Die Mitglieder bleiben bestehen, nur die Gruppierung entfällt.`
            : ""
        }
        confirmLabel="Löschen"
        destructive
        loading={remove.isPending}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}

type Proposal = {
  zahler: { id: string; reference: string; name: string; geburtsdatum: string | Date | null };
  suggestedName: string;
  kandidaten: Array<{
    id: string;
    reference: string;
    name: string;
    geburtsdatum: string | Date | null;
    rolle: "partner" | "kind";
    gleicheAdresse: boolean;
    verknuepft: boolean;
  }>;
};

function ProposalCard({
  proposal,
  onCreated,
}: {
  proposal: Proposal;
  onCreated: () => void | Promise<void>;
}) {
  const [name, setName] = useState(proposal.suggestedName);
  const [selected, setSelected] = useState<Record<string, "partner" | "kind" | "aus">>(() =>
    Object.fromEntries(proposal.kandidaten.map((k) => [k.id, k.rolle])),
  );

  const create = useMutation({
    mutationFn: () =>
      orpc.familien.create({
        name,
        zahlerMemberId: proposal.zahler.id,
        mitglieder: [
          { memberId: proposal.zahler.id, rolle: "zahler" as const },
          ...proposal.kandidaten
            .filter((k) => selected[k.id] !== "aus")
            .map((k) => ({ memberId: k.id, rolle: selected[k.id] as "partner" | "kind" })),
        ],
      }),
    onSuccess: async () => {
      toast.success(`${name} angelegt`);
      await onCreated();
    },
    onError: (e: Error) => toast.error("Anlegen fehlgeschlagen", { description: e.message }),
  });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-md border border-input bg-card px-2 py-1 text-sm font-medium"
          aria-label="Name der Familie"
        />
        <Button
          size="sm"
          onClick={() => create.mutate()}
          disabled={create.isPending || name.trim() === ""}
        >
          {create.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Check className="size-4" />
          )}
          Familie anlegen
        </Button>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Crown className="size-3.5 text-brand" aria-hidden />
        <Link
          to="/app/mitglieder/$mitgliedsnummer"
          params={{ mitgliedsnummer: proposal.zahler.reference }}
          className="font-medium text-primary hover:underline"
        >
          {proposal.zahler.name}
        </Link>
        <Badge>Zahler</Badge>
        <span className="text-xs text-muted-foreground">hält den Familienbeitrag</span>
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {proposal.kandidaten.map((k) => (
          <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <Link
                to="/app/mitglieder/$mitgliedsnummer"
                params={{ mitgliedsnummer: k.reference }}
                className="truncate text-sm text-primary hover:underline"
              >
                {k.name}
              </Link>
              {k.geburtsdatum ? (
                <span className="text-xs text-muted-foreground">
                  * {formatDate(k.geburtsdatum)}
                </span>
              ) : null}
              <span className="flex gap-1">
                {k.verknuepft ? <Badge variant="outline">Verknüpft</Badge> : null}
                {k.gleicheAdresse ? <Badge variant="outline">Gleiche Adresse</Badge> : null}
              </span>
            </div>
            <select
              value={selected[k.id]}
              onChange={(e) =>
                setSelected((s) => ({ ...s, [k.id]: e.target.value as "partner" | "kind" | "aus" }))
              }
              className="h-8 rounded-md border border-input bg-card px-2 text-xs"
              aria-label={`Rolle für ${k.name}`}
            >
              <option value="kind">Kind</option>
              <option value="partner">Partner</option>
              <option value="aus">Nicht übernehmen</option>
            </select>
          </li>
        ))}
      </ul>
    </div>
  );
}
