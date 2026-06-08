import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Plus } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { InfoBox } from "~/components/ui/info-box";
import { SkeletonText } from "~/components/ui/skeleton";
import { formatCurrency, formatDate } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/forderungen/mahnungen/")({
  component: MahnungenListPage,
});

function MahnungenListPage() {
  const list = useQuery({
    queryKey: ["dunning.list"],
    queryFn: () => orpc.dunning.list({ page: 1, pageSize: 100 }),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link to="/app/forderungen" className="inline-flex items-center gap-1 hover:underline">
              <ArrowLeft className="size-3" /> Forderungen
            </Link>
          </div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Mahnläufe</h1>
          <p className="text-sm text-muted-foreground">
            Erstellte Erinnerungen und Mahnungen. PDFs lassen sich pro Empfänger herunterladen.
          </p>
        </div>
        <Link to="/app/forderungen/mahnungen/neu">
          <Button>
            <Plus className="size-4" /> Neuer Mahnlauf
          </Button>
        </Link>
      </div>

      <InfoBox title="So läuft ein Mahnlauf ab" collapsible defaultOpen={false}>
        <ol className="ml-4 list-decimal space-y-1">
          <li>
            <strong>Stufe wählen</strong>: Erinnerung, 1. Mahnung oder 2. Mahnung. Für die nächste
            Stufe muss die vorherige bereits gelaufen sein.
          </li>
          <li>
            <strong>Vorschau</strong>: Es werden alle Mitglieder gelistet, die für die gewählte
            Stufe in Frage kommen. Mahngesperrte Mitglieder werden übersprungen.
          </li>
          <li>
            <strong>Empfänger auswählen</strong>: Standardmäßig sind alle ausgewählt. Einzelne
            können abgewählt werden, etwa wenn vorab telefonisch geklärt.
          </li>
          <li>
            <strong>Abschicken</strong>: Der Lauf erzeugt PDFs pro Empfänger, schreibt die Mahnstufe
            und Mahngebühr auf den Sollstellungen fort und legt einen Eintrag im Audit an. Versand
            der PDFs erfolgt manuell (Druck oder E-Mail).
          </li>
        </ol>
        <p className="mt-2 text-xs text-muted-foreground">
          Ein erstellter Lauf lässt sich im Detail stornieren. Dann werden Mahnstufe und Gebühr auf
          den betroffenen Posten zurückgesetzt.
        </p>
      </InfoBox>

      <Card>
        <CardHeader>
          <CardTitle>Bisherige Läufe</CardTitle>
        </CardHeader>
        <CardContent>
          {list.isLoading ? (
            <SkeletonText lines={5} className="max-w-md" />
          ) : !list.data || list.data.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Bisher keine Mahnläufe erstellt.</p>
          ) : (
            <ul className="divide-y">
              {list.data.rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-3">
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to="/app/forderungen/mahnungen/$id"
                        params={{ id: r.id }}
                        className="font-medium hover:underline"
                      >
                        {labelFor(r.level)} · {formatDate(r.runDate)}
                      </Link>
                      <StatusBadge status={r.status} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {r.itemCount} Empfänger · offen {formatCurrency(r.totalOpen)} · Gebühren{" "}
                      {formatCurrency(r.totalFees)} · Frist {formatDate(r.dueDate)}
                    </p>
                  </div>
                  <Link to="/app/forderungen/mahnungen/$id" params={{ id: r.id }}>
                    <Button variant="ghost" size="sm">
                      Details
                    </Button>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function labelFor(level: number): string {
  if (level === 1) return "Erinnerung";
  if (level === 2) return "1. Mahnung";
  return "2. Mahnung";
}

function StatusBadge({ status }: { status: string }) {
  if (status === "committed") return <Badge variant="success">aktiv</Badge>;
  if (status === "cancelled") return <Badge variant="destructive">storniert</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}
