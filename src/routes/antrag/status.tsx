import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import {
  Check,
  CheckCircle2,
  Clock,
  FileCheck,
  Inbox,
  Loader2,
  Search,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/cn";
import { formatDate } from "~/lib/format";
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

// Ordered timeline of the happy path. The lookup status maps onto one of these
// stages; a decline is handled separately as a terminal alternate state.
const TIMELINE = [
  { icon: Inbox, title: "Eingegangen", note: "Ihr Antrag wurde eingereicht." },
  { icon: FileCheck, title: "Dokument erhalten", note: "Die unterschriebene Erklärung liegt vor." },
  { icon: Clock, title: "In Bearbeitung", note: "Der Verein prüft Ihren Antrag." },
  { icon: CheckCircle2, title: "Genehmigt", note: "Ihre Mitgliedschaft ist bestätigt." },
];

const STAGE_INDEX: Record<string, number> = {
  neu: 0,
  scan_eingegangen: 1,
  dokument_hochgeladen: 1,
  in_bearbeitung: 2,
  genehmigt: 3,
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
  const stage = data ? (STAGE_INDEX[data.status] ?? 0) : 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Antragsstatus</h1>
        <p className="text-sm text-muted-foreground">
          Geben Sie Ihre Antragsnummer ein, um den aktuellen Stand zu sehen. Sie finden die Nummer
          in Ihrer Bestätigungs-E-Mail (Format ANT-JJJJ-XXXX).
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
        <Card className="motion-reveal-up">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {declined ? (
                <XCircle className="size-5 text-destructive" />
              ) : (
                <Clock className="size-5 text-muted-foreground" />
              )}
              {STATUS_LABELS[data.status] ?? data.status}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Antragsnummer{" "}
              <span className="font-medium text-foreground">{data.antragsnummer}</span>
              {data.createdAt ? <> · eingereicht am {formatDate(data.createdAt)}</> : null}
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {declined ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
                Ihr Antrag wurde leider abgelehnt.
                {data.declineReason ? (
                  <span className="mt-1 block">
                    <span className="font-medium">Begründung:</span> {data.declineReason}
                  </span>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col">
                {TIMELINE.map((t, i) => {
                  const done = i < stage;
                  const current = i === stage;
                  const Icon = t.icon;
                  return (
                    <div key={t.title} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span
                          className={cn(
                            "flex size-8 shrink-0 items-center justify-center rounded-full transition-colors",
                            done
                              ? "bg-success/15 text-success"
                              : current
                                ? "bg-primary/15 text-primary"
                                : "bg-muted text-muted-foreground",
                          )}
                        >
                          {done ? <Check className="size-4" /> : <Icon className="size-4" />}
                        </span>
                        {i < TIMELINE.length - 1 ? (
                          <span
                            className={cn(
                              "my-1 w-px flex-1",
                              i < stage ? "bg-success/40" : "bg-border",
                            )}
                          />
                        ) : null}
                      </div>
                      <div className={cn("pb-4", current ? "" : !done ? "opacity-60" : "")}>
                        <div className="text-sm font-medium">{t.title}</div>
                        <div className="text-xs text-muted-foreground">{t.note}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
