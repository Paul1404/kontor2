import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { CheckCircle2, Clock, Loader2, Search, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/antrag/status")({
  component: StatusPage,
  validateSearch: (s: Record<string, unknown>): { nr?: string } => ({
    nr: typeof s.nr === "string" ? s.nr : undefined,
  }),
});

const STATUS_LABELS: Record<string, string> = {
  neu: "Eingegangen",
  scan_eingegangen: "Papier-Scan eingegangen",
  dokument_hochgeladen: "Dokument hochgeladen",
  in_bearbeitung: "In Bearbeitung",
  genehmigt: "Genehmigt",
  abgelehnt: "Abgelehnt",
};

function StatusPage() {
  const { nr } = useSearch({ from: "/antrag/status" });
  const [query, setQuery] = useState(nr ?? "");

  const lookup = useMutation({
    mutationFn: (antragsnummer: string) => orpc.applications.lookupStatus({ antragsnummer }),
  });

  // Auto-run the lookup when arriving with ?nr=ANT-... The mutation handle is
  // stable; we intentionally only react to the URL parameter changing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run on nr change only
  useEffect(() => {
    if (nr) lookup.mutate(nr);
  }, [nr]);

  const data = lookup.data;
  const declined = data?.status === "abgelehnt";
  const approved = data?.status === "genehmigt";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Antragsstatus</h1>
        <p className="text-sm text-muted-foreground">
          Geben Sie Ihre Antragsnummer ein, um den aktuellen Stand zu sehen.
        </p>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) lookup.mutate(query.trim());
        }}
      >
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ANT-2026-0001"
          aria-label="Antragsnummer"
        />
        <Button type="submit" disabled={lookup.isPending || !query.trim()}>
          {lookup.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Search className="size-4" />
          )}
          Suchen
        </Button>
      </form>

      {lookup.isError ? (
        <p className="text-sm text-destructive">
          Diese Antragsnummer wurde nicht gefunden. Bitte prüfen Sie Ihre Eingabe.
        </p>
      ) : null}

      {data ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {approved ? (
                <CheckCircle2 className="size-5 text-success" />
              ) : declined ? (
                <XCircle className="size-5 text-destructive" />
              ) : (
                <Clock className="size-5 text-muted-foreground" />
              )}
              {STATUS_LABELS[data.status] ?? data.status}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div className="text-muted-foreground">
              Antragsnummer:{" "}
              <span className="font-medium text-foreground">{data.antragsnummer}</span>
            </div>
            {declined && data.declineReason ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
                Begründung: {data.declineReason}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
