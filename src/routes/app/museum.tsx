import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Landmark, ShieldAlert } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import { LEGACY_EXHIBITS, LEGACY_STATS } from "~/lib/legacy-schema-trivia";

/**
 * Hidden easter egg. Not in the navigation. Reached by tapping the version
 * chip in the sidebar seven times. A small museum for the legacy Linear
 * Webverein database schema this app replaced.
 */
export const Route = createFileRoute("/app/museum")({
  component: MuseumPage,
});

function MuseumPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          to="/app"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Zurück
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Landmark className="size-6 text-brand" /> Museum für Datenbank-Altertümer
        </h1>
        <p className="text-sm text-muted-foreground">
          Eine kleine Ausstellung zum Schema der alten Linear Webverein-Datenbank, die diese App
          abgelöst hat. Alle Zahlen und Spaltennamen sind echt, direkt aus dem
          Original-Datenbankabzug. Nichts erfunden. Leider.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile value={String(LEGACY_STATS.tables)} label="Tabellen" />
        <StatTile value={LEGACY_STATS.totalColumns.toLocaleString("de-DE")} label="Spalten" />
        <StatTile value={String(LEGACY_STATS.widestTable.columns)} label="breiteste Tabelle" />
        <StatTile value={String(LEGACY_STATS.adresseColumns)} label="Spalten pro Adresse" />
      </div>

      <div className="flex flex-col gap-3">
        {LEGACY_EXHIBITS.map((ex) => (
          <Card key={ex.title}>
            <CardContent className="flex flex-col gap-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <ShieldAlert className="size-4 shrink-0 text-amber-500" />
                <span className="font-medium">{ex.title}</span>
                {ex.stat ? <Badge variant="warning">{ex.stat}</Badge> : null}
              </div>
              <p className="text-sm text-muted-foreground">{ex.blurb}</p>
              {ex.evidence && ex.evidence.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {ex.evidence.map((e) => (
                    <code
                      key={e}
                      className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
                    >
                      {e}
                    </code>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="pb-4 text-center text-xs text-muted-foreground">
        Heute: ein paar saubere, normalisierte Tabellen. Damals: das hier.
      </p>
    </div>
  );
}

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-card px-3 py-3 text-center">
      <span className="font-mono text-2xl font-semibold tabular-nums">{value}</span>
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  );
}
