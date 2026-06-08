import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Share2, Users } from "lucide-react";
import { RelationshipGraph } from "~/components/netzwerk/RelationshipGraph";
import { Card, CardContent } from "~/components/ui/card";
import { QueryError } from "~/components/ui/query-error";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/netzwerk")({
  component: NetzwerkPage,
});

function NetzwerkPage() {
  const graph = useQuery({
    queryKey: ["relationships.graph"],
    queryFn: () => orpc.relationships.graph(),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Share2 className="size-6 text-brand" /> Beziehungsnetzwerk
        </h1>
        <p className="text-sm text-muted-foreground">
          Alle Verknüpfungen zwischen Mitgliedern und Kontakten als Karte. Ziehen zum Verschieben,
          scrollen zum Zoomen, Klick öffnet das Mitglied.
        </p>
      </div>

      {graph.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Lade Beziehungen…
        </div>
      ) : graph.isError ? (
        <QueryError onRetry={() => graph.refetch()} />
      ) : graph.data && graph.data.nodes.length === 0 ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm">
            <Users className="size-8 text-muted-foreground" />
            <div>
              <div className="font-semibold tracking-tight">Keine Beziehungen erfasst.</div>
              <div className="text-muted-foreground">
                Sobald Mitglieder miteinander verknüpft sind, erscheinen sie hier als Netzwerk.
              </div>
            </div>
          </CardContent>
        </Card>
      ) : graph.data ? (
        <div className="flex flex-col gap-3">
          {graph.data.capped ? (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              Sehr großes Netzwerk. Es wird nur ein Ausschnitt angezeigt.
            </p>
          ) : null}
          <RelationshipGraph nodes={graph.data.nodes} edges={graph.data.edges} />
        </div>
      ) : null}
    </div>
  );
}
